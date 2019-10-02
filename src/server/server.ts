import * as os from "os"
import { ReadWriteConnection, Logger, DefaultLogger, ConnectionStatus } from "../common/connection"
import * as Message from "../common/messages"
import { Module, ServerProxy } from "../common/proxy"
import { isPromise, isProxy } from "../common/util"
import { Argument, encode, decode } from "../common/arguments"
import { ChildProcessModuleProxy, ForkProvider } from "./child_process"
import { FsModuleProxy } from "./fs"
import { NetModuleProxy } from "./net"

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ServerOptions {
  readonly fork?: ForkProvider
  readonly logger?: Logger
}

interface ProxyData {
  disposeTimeout?: number | NodeJS.Timer
  instance: any
}

/**
 * Handle messages from the client.
 */
export class Server {
  private proxyId = 0
  private readonly proxies = new Map<number | Module, ProxyData>()
  private status = ConnectionStatus.Connected
  private readonly responseTimeout = 10000
  private readonly logger: Logger

  public constructor(private readonly connection: ReadWriteConnection, private readonly options?: ServerOptions) {
    this.logger = (options && options.logger) || new DefaultLogger("server")
    connection.onMessage(async (data) => {
      try {
        await this.handleMessage(JSON.parse(data))
      } catch (error) {
        this.logger.error("Failed to handle client message", { error: error.message })
      }
    })

    const handleDisconnect = (permanent?: boolean): void => {
      this.status = permanent ? ConnectionStatus.Closed : ConnectionStatus.Disconnected
      this.logger.trace(`disconnected${permanent ? " permanently" : ""} from client`, { proxies: this.proxies.size })
      this.proxies.forEach((proxy, proxyId) => {
        if (isProxy(proxy.instance)) {
          proxy.instance.dispose().catch((error) => {
            this.logger.error(error.message)
          })
        }
        // Top-level proxies can continue to be used.
        if (permanent || typeof proxyId === "number") {
          this.removeProxy(proxyId)
        }
      })
    }

    connection.onDown(() => handleDisconnect())
    connection.onClose(() => handleDisconnect(true))
    connection.onUp(() => {
      if (this.status === ConnectionStatus.Disconnected) {
        this.logger.trace("reconnected to client")
        this.status = ConnectionStatus.Connected
      }
    })

    this.storeProxy(new ChildProcessModuleProxy(this.options ? this.options.fork : undefined), Module.ChildProcess)
    this.storeProxy(new FsModuleProxy(), Module.Fs)
    this.storeProxy(new NetModuleProxy(), Module.Net)

    this.send({
      type: Message.Server.Type.Init,
      os: os.platform(),
    } as Message.Server.Init)
  }

  /**
   * Handle all messages from the client.
   */
  private async handleMessage(message: Message.Client.Message): Promise<void> {
    switch (message.type) {
      case Message.Client.Type.Proxy:
        await this.runMethod(message)
        break
      case Message.Client.Type.Ping:
        this.logger.trace("ping")
        this.send({
          type: Message.Server.Type.Pong,
        } as Message.Server.Pong)
        break
      default:
        throw new Error(`unknown message type ${(message as any).type}`)
    }
  }

  /**
   * Run a method on a proxy.
   */
  private async runMethod(message: Message.Client.Proxy): Promise<void> {
    const messageId = message.messageId
    const proxyId = message.proxyId
    const method = message.method
    const args = message.args.map((a) => {
      return decode(a, (id, args) => this.sendCallback(proxyId, id, args), (id) => this.getProxy(id).instance)
    })

    this.logger.trace("received", { messageId, proxyId, method, args })

    let response: any
    try {
      const proxy = this.getProxy(proxyId)
      if (typeof proxy.instance[method] !== "function") {
        throw new Error(`"${method}" is not a function on proxy ${proxyId}`)
      }

      response = proxy.instance[method](...args)

      // We wait for the client to call "dispose" instead of doing it onDone to
      // ensure all the messages it sent get processed before we get rid of it.
      if (method === "dispose") {
        this.removeProxy(proxyId)
      }

      // Proxies must always return promises.
      if (!isPromise(response)) {
        throw new Error(`"${method}" must return a promise`)
      }
    } catch (error) {
      this.logger.error(error.message, { type: typeof response, proxyId })
      this.sendException(messageId, error)
    }

    try {
      this.sendResponse(messageId, await response)
    } catch (error) {
      this.sendException(messageId, error)
    }
  }

  /**
   * Send a callback to the client.
   */
  private sendCallback(proxyId: number | Module, callbackId: number, args: any[]): void {
    this.logger.trace("sending callback", { proxyId, callbackId })
    this.send({
      type: Message.Server.Type.Callback,
      callbackId,
      proxyId,
      args: args.map((a) => this.encode(a)),
    } as Message.Server.Callback)
  }

  /**
   * Store a numbered proxy and bind events to send them back to the client.
   */
  private storeProxy(instance: ServerProxy): number
  /**
   * Store a unique proxy and bind events to send them back to the client.
   */
  private storeProxy(instance: any, moduleProxyId: Module): Module
  /**
   * Store a proxy and bind events to send them back to the client.
   */
  private storeProxy(instance: ServerProxy | any, moduleProxyId?: Module): number | Module {
    // In case we disposed while waiting for a function to return.
    if (this.status !== ConnectionStatus.Connected) {
      if (isProxy(instance)) {
        instance.dispose().catch((error) => {
          this.logger.error(error.message)
        })
      }

      throw new Error("disposed")
    }

    const proxyId = moduleProxyId || this.proxyId++
    this.logger.trace("storing proxy", { proxyId })

    this.proxies.set(proxyId, { instance })

    if (isProxy(instance)) {
      instance.onEvent((event, ...args) => this.sendEvent(proxyId, event, ...args))
      instance.onDone(() => {
        // It might have finished because we disposed it due to a disconnect.
        if (this.status === ConnectionStatus.Connected) {
          this.sendEvent(proxyId, "done")
          this.getProxy(proxyId).disposeTimeout = setTimeout(() => {
            instance.dispose().catch((error) => {
              this.logger.error(error.message)
            })
            this.removeProxy(proxyId)
          }, this.responseTimeout)
        }
      })
    }

    return proxyId
  }

  /**
   * Send an event to the client.
   */
  private sendEvent(proxyId: number | Module, event: string, ...args: any[]): void {
    this.logger.trace("sending event", () => ({
      proxyId,
      event,
      args: args.map((a) => (a instanceof Buffer ? a.toString() : a)),
    }))
    this.send({
      type: Message.Server.Type.Event,
      event,
      proxyId,
      args: args.map((a) => this.encode(a)),
    } as Message.Server.Event)
  }

  /**
   * Send a response back to the client.
   */
  private sendResponse(messageId: number, response: any): void {
    const encoded = this.encode(response)
    this.logger.trace("sending resolve", { messageId, response: encoded })
    this.send({
      type: Message.Server.Type.Success,
      messageId,
      response: encoded,
    } as Message.Server.Success)
  }

  /**
   * Send an exception back to the client.
   */
  private sendException(messageId: number, error: Error): void {
    this.logger.trace("sending reject", { messageId, message: error.message })
    this.send({
      type: Message.Server.Type.Fail,
      messageId,
      response: this.encode(error),
    } as Message.Server.Fail)
  }

  /**
   * Call after disposing a proxy.
   */
  private removeProxy(proxyId: number | Module): void {
    clearTimeout(this.getProxy(proxyId).disposeTimeout as any)
    this.proxies.delete(proxyId)
    this.logger.trace("disposed and removed proxy", { proxyId, proxies: this.proxies.size })
  }

  /**
   * Same as encode but provides storeProxy.
   */
  private encode(value: any): Argument {
    return encode(value, undefined, (p) => this.storeProxy(p))
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

  private send(message: Message.Server.Message): void {
    if (this.status === ConnectionStatus.Connected) {
      this.connection.send(JSON.stringify(message))
    }
  }
}
