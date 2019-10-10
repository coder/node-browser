import * as buffer from "buffer"
import { ExecException, ExecOptions } from "child_process"
import * as crypto from "crypto"
import * as events from "events"
import { PathLike } from "fs"
import * as stream from "stream"
import * as timers from "timers"
import * as tty from "tty"
import * as path from "path"
import * as util from "util"
import { Argument, decode, encode } from "../common/arguments"
import { ConnectionStatus, DefaultLogger, Logger, ReadWriteConnection } from "../common/connection"
import { Emitter } from "../common/events"
import * as Message from "../common/messages"
import { ClientServerProxy, Module, ServerProxy } from "../common/proxy"
import { ChildProcessModule } from "./child_process"
import { FsModule } from "./fs"
import { NetModule } from "./net"
import { OsModule } from "./os"

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ClientOptions {
  readonly logger?: Logger
}

interface ProxyData {
  promise: Promise<void>
  instance: any
  callbacks: Map<number, (...args: any[]) => void>
}

/**
 * Client accepts a connection to communicate with the server.
 */
export class Client {
  private messageId = 0
  private callbackId = 0
  private clientId = (Math.random() * 0x100000000) >>> 0
  private readonly proxies = new Map<number | Module, ProxyData>()
  private readonly successEmitter = new Emitter<Message.Server.Success>()
  private readonly failEmitter = new Emitter<Message.Server.Fail>()
  private readonly eventEmitter = new Emitter<{ event: string; args: any[] }>()
  private readonly initDataEmitter = new Emitter<Message.Server.InitData>()

  private status = ConnectionStatus.Connected

  // The socket timeout is 60s, so we need to send a ping periodically to
  // prevent it from closing.
  private pingTimeout: NodeJS.Timer | number | undefined
  private readonly pingTimeoutDelay = 30000

  private readonly responseTimeout = 10000

  public readonly modules: {
    [Module.Buffer]: typeof buffer
    [Module.ChildProcess]: ChildProcessModule
    [Module.Crypto]: typeof crypto
    [Module.Events]: typeof events
    [Module.Fs]: FsModule
    [Module.Net]: NetModule
    [Module.Os]: OsModule
    [Module.Path]: typeof path
    [Module.Process]: typeof process
    [Module.Stream]: typeof stream
    [Module.Timers]: typeof timers
    [Module.Tty]: typeof tty
    [Module.Util]: typeof util
  }

  private readonly logger: Logger

  private readonly _handshake: Promise<Message.Server.InitData>

  /**
   * @param connection Established connection to the server
   */
  public constructor(private readonly connection: ReadWriteConnection, private readonly options?: ClientOptions) {
    this.logger = (this.options && this.options.logger) || new DefaultLogger("client")
    connection.onMessage(async (data) => {
      try {
        await this.handleMessage(JSON.parse(data))
      } catch (error) {
        this.logger.error("failed to handle server message", { error: error.message })
      }
    })

    this._handshake = new Promise((resolve): void => {
      const d = this.initDataEmitter.event((data) => {
        d.dispose()
        resolve(data)
      })
      this.send<Message.Client.Handshake>({
        type: Message.Client.Type.Handshake,
        clientId: this.clientId,
      })
    })

    this.createProxy(Module.ChildProcess)
    this.createProxy(Module.Fs)
    this.createProxy(Module.Net)

    this.modules = {
      [Module.Buffer]: buffer,
      [Module.ChildProcess]: new ChildProcessModule(this.getProxy(Module.ChildProcess).instance),
      [Module.Crypto]: crypto,
      [Module.Events]: events,
      [Module.Fs]: new FsModule(this.getProxy(Module.Fs).instance),
      [Module.Net]: new NetModule(this.getProxy(Module.Net).instance),
      [Module.Os]: new OsModule(this._handshake),
      [Module.Path]: path,
      [Module.Process]: process,
      [Module.Stream]: stream,
      [Module.Timers]: timers,
      [Module.Tty]: tty,
      [Module.Util]: util,
    }

    // Methods that don't follow the standard callback pattern (an error
    // followed by a single result) need to provide a custom promisify function.
    Object.defineProperty(this.modules[Module.Fs].exists, util.promisify.custom, {
      value: (path: PathLike): Promise<boolean> => {
        return new Promise((resolve): void => this.modules[Module.Fs].exists(path, resolve))
      },
    })

    Object.defineProperty(this.modules[Module.ChildProcess].exec, util.promisify.custom, {
      value: (
        command: string,
        options?: { encoding?: string | null } & ExecOptions | null
      ): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> => {
        return new Promise((resolve, reject): void => {
          this.modules[Module.ChildProcess].exec(
            command,
            options,
            (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => {
              if (error) {
                reject(error)
              } else {
                resolve({ stdout, stderr })
              }
            }
          )
        })
      },
    })

    /**
     * If the connection is interrupted, the calls will neither succeed nor fail
     * nor exit so we need to send a failure on all of them as well as trigger
     * events so things like child processes can clean up and possibly restart.
     */
    const handleDisconnect = (permanent?: boolean): void => {
      this.status = permanent ? ConnectionStatus.Closed : ConnectionStatus.Disconnected
      this.logger.trace(`disconnected${permanent ? " permanently" : ""} from server`, () => ({
        proxies: this.proxies.size,
        callbacks: Array.from(this.proxies.values()).reduce((count, p) => count + p.callbacks.size, 0),
        success: this.successEmitter.counts,
        fail: this.failEmitter.counts,
        event: this.eventEmitter.counts,
      }))

      const error = new Error("disconnected")
      this.failEmitter.emit({
        type: Message.Server.Type.Fail,
        clientId: this.clientId,
        messageId: -1,
        response: encode(error),
      })

      this.eventEmitter.emit({ event: "disconnected", args: [error] })
      this.eventEmitter.emit({ event: "done", args: [] })
    }

    connection.onDown(() => handleDisconnect())
    connection.onClose(() => {
      clearTimeout(this.pingTimeout as any)
      this.pingTimeout = undefined
      handleDisconnect(true)
      this.proxies.clear()
      this.successEmitter.dispose()
      this.failEmitter.dispose()
      this.eventEmitter.dispose()
      this.initDataEmitter.dispose()
    })
    connection.onUp(() => {
      if (this.status === ConnectionStatus.Disconnected) {
        this.logger.trace("reconnected to server")
        this.status = ConnectionStatus.Connected
      }
    })

    this.startPinging()
  }

  /**
   * Get the handshake promise. This isn't necessary to start communicating but
   * is generally a good idea since some fills get their data from it.
   */
  public handshake(): Promise<Message.Server.InitData> {
    return this._handshake
  }

  /**
   * Make a remote call for a proxy's method.
   */
  private remoteCall(proxyId: number | Module, method: string, args: any[]): Promise<any> {
    // Assume killing and closing works because a disconnected proxy is disposed
    // on the server and a non-existent proxy has already been disposed.
    if (typeof proxyId === "number" && (this.status !== ConnectionStatus.Connected || !this.proxies.has(proxyId))) {
      switch (method) {
        case "close":
        case "kill":
          return Promise.resolve()
      }
    }

    if (this.status !== ConnectionStatus.Connected) {
      return Promise.reject(new Error(`Unable to call "${method}" on proxy ${proxyId}: disconnected`))
    }

    // We won't have garbage collection on callbacks so they should only be used
    // if they are long-lived or on proxies that dispose around the same time
    // the callback becomes invalid.
    const storeCallback = (cb: (...args: any[]) => void): number => {
      const callbackId = this.callbackId++
      this.logger.trace("storing callback", { proxyId, callbackId })

      this.getProxy(proxyId).callbacks.set(callbackId, cb)

      return callbackId
    }

    const messageId = this.messageId++
    const message: Message.Client.Proxy = {
      type: Message.Client.Type.Proxy,
      clientId: this.clientId,
      messageId,
      proxyId,
      method,
      args: args.map((a) => encode<ClientServerProxy>(a, storeCallback, (p) => p.proxyId)),
    }

    this.logger.trace("sending", { messageId, proxyId, method, args })

    this.send<Message.Client.Proxy>(message)

    // The server will send back a fail or success message when the method
    // has completed, so we listen for that based on the message's unique ID.
    const promise = new Promise((resolve, reject): void => {
      const dispose = (): void => {
        /* eslint-disable @typescript-eslint/no-use-before-define */
        d1.dispose()
        d2.dispose()
        clearTimeout(timeout as any)
        /* eslint-enable @typescript-eslint/no-use-before-define */
      }

      const timeout = setTimeout(() => {
        dispose()
        reject(new Error("timed out"))
      }, this.responseTimeout)

      const d1 = this.successEmitter.event(messageId, (message) => {
        dispose()
        resolve(this.decode(message.response, promise))
      })

      const d2 = this.failEmitter.event(messageId, (message) => {
        dispose()
        reject(decode(message.response))
      })
    })

    return promise
  }

  /**
   * Handle all messages from the server.
   */
  private async handleMessage(message: Message.Server.Message): Promise<void> {
    if (this.status !== ConnectionStatus.Connected || message.clientId !== this.clientId) {
      if (this.status !== ConnectionStatus.Connected) {
        this.logger.trace("discarding message", { message })
      }
      return
    }
    switch (message.type) {
      case Message.Server.Type.Callback:
        return this.runCallback(message)
      case Message.Server.Type.Event:
        return this.emitEvent(message)
      case Message.Server.Type.Fail:
        return this.emitFail(message)
      case Message.Server.Type.Init:
        return this.initDataEmitter.emit(message)
      case Message.Server.Type.Pong:
        // Nothing to do since pings are on a timer rather than waiting for the
        // next pong in case a message from either the client or server is
        // dropped which would break the ping cycle.
        return this.logger.trace("received pong")
      case Message.Server.Type.Success:
        return this.emitSuccess(message)
      default:
        throw new Error(`unknown message type ${(message as any).type}`)
    }
  }

  /**
   * Convert success message to a success event.
   */
  private emitSuccess(message: Message.Server.Success): void {
    this.logger.trace("received resolve", message)
    this.successEmitter.emit(message.messageId, message)
  }

  /**
   * Convert fail message to a fail event.
   */
  private emitFail(message: Message.Server.Fail): void {
    this.logger.trace("received reject", message)
    this.failEmitter.emit(message.messageId, message)
  }

  /**
   * Emit an event received from the server. We could send requests for "on" to
   * the server and serialize functions using IDs, but doing it that way makes
   * it possible to miss events depending on whether the server receives the
   * request before it emits. Instead, emit all events from the server so all
   * events are always caught on the client.
   */
  private async emitEvent(message: Message.Server.Event): Promise<void> {
    await this.ensureResolved(message.proxyId)
    const args = message.args.map((a) => this.decode(a))
    this.logger.trace("received event", () => ({
      proxyId: message.proxyId,
      event: message.event,
      args: args.map((a) => (a instanceof Buffer ? a.toString() : a)),
    }))
    this.eventEmitter.emit(message.proxyId, {
      event: message.event,
      args,
    })
  }

  /**
   * Run a callback as requested by the server. Since we don't know when
   * callbacks get garbage collected we dispose them only when the proxy
   * disposes. That means they should only be used if they run for the lifetime
   * of the proxy (like child_process.exec), otherwise we'll leak. They should
   * also only be used when passed together with the method. If they are sent
   * afterward, they may never be called due to timing issues.
   */
  private async runCallback(message: Message.Server.Callback): Promise<void> {
    await this.ensureResolved(message.proxyId)
    this.logger.trace("running callback", { proxyId: message.proxyId, callbackId: message.callbackId })
    const cb = this.getProxy(message.proxyId).callbacks.get(message.callbackId)
    if (cb) {
      cb(...message.args.map((a) => this.decode(a)))
    }
  }

  /**
   * Start the ping loop. Does nothing if already pinging.
   */
  private readonly startPinging = (): void => {
    if (typeof this.pingTimeout !== "undefined") {
      return
    }

    const schedulePing = (): void => {
      this.pingTimeout = setTimeout(() => {
        this.send<Message.Client.Ping>({
          type: Message.Client.Type.Ping,
          clientId: this.clientId,
        })
        schedulePing()
      }, this.pingTimeoutDelay)
    }

    schedulePing()
  }

  /**
   * Return a proxy that makes remote calls.
   */
  private createProxy<T extends ClientServerProxy>(
    proxyId: number | Module,
    promise: Promise<any> = Promise.resolve()
  ): T {
    this.logger.trace("creating proxy", { proxyId })

    const instance = new Proxy(
      {
        proxyId,
        onDone: (cb: (...args: any[]) => void): void => {
          this.eventEmitter.event(proxyId, (event) => {
            if (event.event === "done") {
              cb(...event.args)
            }
          })
        },
        onEvent: (cb: (event: string, ...args: any[]) => void): void => {
          this.eventEmitter.event(proxyId, (event) => {
            cb(event.event, ...event.args)
          })
        },
      } as ClientServerProxy,
      {
        get: (target: any, name: string): any => {
          // When resolving a promise with a proxy, it will check for "then".
          if (name === "then") {
            return
          }

          if (typeof target[name] === "undefined") {
            target[name] = (...args: any[]): Promise<any> | ServerProxy => {
              return this.remoteCall(proxyId, name, args)
            }
          }

          return target[name]
        },
      }
    )

    this.proxies.set(proxyId, {
      promise,
      instance,
      callbacks: new Map(),
    })

    instance.onDone(() => {
      const log = (): void => {
        this.logger.trace(typeof proxyId === "number" ? "disposed proxy" : "disposed proxy callbacks", () => ({
          proxyId,
          proxies: this.proxies.size,
          status: this.status,
          callbacks: Array.from(this.proxies.values()).reduce((count, proxy) => count + proxy.callbacks.size, 0),
          success: this.successEmitter.counts,
          fail: this.failEmitter.counts,
          event: this.eventEmitter.counts,
        }))
      }

      // Uniquely identified items (top-level module proxies) can continue to
      // be used so we don't need to delete them.
      if (typeof proxyId === "number") {
        const dispose = (): void => {
          this.proxies.delete(proxyId)
          this.eventEmitter.dispose(proxyId)
          log()
        }
        if (this.status === ConnectionStatus.Connected) {
          instance
            .dispose()
            .then(dispose)
            .catch(dispose)
        } else {
          dispose()
        }
      } else {
        // The callbacks will still be unusable though so clear them.
        this.getProxy(proxyId).callbacks.clear()
        log()
      }
    })

    return instance
  }

  /**
   * We aren't guaranteed the promise will call all the `then` callbacks
   * synchronously once it resolves, so the event message can come in and fire
   * before a caller has been able to attach an event. Waiting for the promise
   * ensures it runs after everything else.
   */
  private async ensureResolved(proxyId: number | Module): Promise<void> {
    await this.getProxy(proxyId).promise
  }

  /**
   * Same as decode except provides createProxy.
   */
  private decode(value?: Argument, promise?: Promise<any>): any {
    return decode(value, undefined, (id) => this.createProxy(id, promise))
  }

  /**
   * Get a proxy. Error if it doesn't exist.
   */
  private getProxy(proxyId: number | Module): ProxyData {
    const proxy = this.proxies.get(proxyId)
    if (!proxy) {
      throw new Error(`proxy ${proxyId} disposed too early`)
    }
    return proxy
  }

  private send<T extends Message.Client.Message>(message: T): void {
    if (this.status === ConnectionStatus.Connected) {
      this.connection.send(JSON.stringify(message))
    }
  }
}
