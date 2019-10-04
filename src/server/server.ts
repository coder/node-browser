import * as os from "os"
import { ReadWriteConnection, Logger, DefaultLogger, ConnectionStatus } from "../common/connection"
import * as Message from "../common/messages"
import { Module, ServerProxy } from "../common/proxy"
import { isPromise, isNonModuleProxy } from "../common/util"
import { Argument, encode, decode } from "../common/arguments"
import { ChildProcessModuleProxy, ForkProvider } from "./child_process"
import { FsModuleProxy } from "./fs"
import { NetModuleProxy } from "./net"

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ServerOptions {
  readonly fork?: ForkProvider
  readonly logger?: Logger
}

type ModuleProxy = ChildProcessModuleProxy | FsModuleProxy | NetModuleProxy

interface ModuleProxyData {
  instance: ModuleProxy
}

interface ProxyData {
  clientId: number
  disposePromise?: Promise<void>
  disposeTimeout?: number | NodeJS.Timer
  instance: ServerProxy
  disconnected?: boolean
}

/**
 * Handle messages from the client.
 */
export class Server {
  private proxyId = 0
  private readonly proxies = new Map<number | Module, ProxyData | ModuleProxyData>()
  private status = ConnectionStatus.Connected
  private readonly responseTimeout = 10000
  private readonly logger: Logger
  private lastDisconnect: number | undefined

  public constructor(private readonly connection: ReadWriteConnection, private readonly options?: ServerOptions) {
    this.logger = (this.options && this.options.logger) || new DefaultLogger("server")

    connection.onMessage(async (data) => {
      try {
        await this.handleMessage(JSON.parse(data))
      } catch (error) {
        this.logger.error("failed to handle client message", { error: error.message })
      }
    })

    const handleDisconnect = (permanent?: boolean): void => {
      this.lastDisconnect = Date.now()
      this.status = permanent ? ConnectionStatus.Closed : ConnectionStatus.Disconnected
      this.logger.trace(`disconnected${permanent ? " permanently" : ""} from client`, { proxies: this.proxies.size })
      this.proxies.forEach((_, proxyId) => {
        this.removeProxy(proxyId, permanent, true)
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
  }

  /**
   * Handle all messages from the client.
   */
  private async handleMessage(message: Message.Client.Message): Promise<void> {
    if (this.status !== ConnectionStatus.Connected) {
      return this.logger.trace("discarding message", { message })
    }
    switch (message.type) {
      case Message.Client.Type.Proxy:
        await this.runMethod(message)
        break
      case Message.Client.Type.Handshake:
        this.send<Message.Server.Init>({
          type: Message.Server.Type.Init,
          clientId: message.clientId,
          env: process.env,
          os: {
            platform: os.platform(),
            homedir: os.homedir(),
            eol: os.EOL,
          },
        })
        break
      case Message.Client.Type.Ping:
        this.logger.trace("received ping")
        this.send<Message.Server.Pong>({
          type: Message.Server.Type.Pong,
          clientId: message.clientId,
        })
        break
      default:
        throw new Error(`unknown message type ${(message as any).type}`)
    }
  }

  /**
   * Run a method on a proxy.
   */
  private async runMethod(message: Message.Client.Proxy): Promise<void> {
    const clientId = message.clientId
    const messageId = message.messageId
    const proxyId = message.proxyId
    const method = message.method
    const args = message.args.map((a) => {
      return decode(
        a,
        (id, args) => this.sendCallback(clientId, proxyId, id, args),
        (id) => this.getProxy(id, "Unable to decode").instance
      )
    })

    this.logger.trace("received", { clientId, messageId, proxyId, method, args })

    let response: any
    try {
      const proxy = this.getProxy(proxyId, `Unable to call ${method}`)
      if (typeof (proxy.instance as any)[method] !== "function") {
        throw new Error(`"${method}" is not a function on proxy ${proxyId}`)
      }

      // We wait for the client to call "dispose" instead of doing it in onDone
      // to ensure all messages get processed before we get rid of it.
      if (method === "dispose") {
        response = this.removeProxy(proxyId)
      } else {
        response = (proxy.instance as any)[method](...args)
      }

      // Proxies must always return promises.
      if (!isPromise(response)) {
        throw new Error(`"${method}" must return a promise`)
      }
    } catch (error) {
      this.logger.error(error.message, { type: typeof response, proxyId })
      this.sendException(clientId, messageId, error)
    }

    // If we disconnect while waiting for a response we need to just dispose
    // and not try sending anything back to the client even if we've
    // reconnected because the client will have already moved on and is not
    // expecting a response so it will just error pointlessly.
    const started = Date.now()
    const disconnected = (): boolean =>
      this.status !== ConnectionStatus.Connected ||
      (!!started && !!this.lastDisconnect && started <= this.lastDisconnect)
    try {
      const value = await response
      if (!disconnected()) {
        this.sendResponse(clientId, messageId, value)
      } else if (isNonModuleProxy(value)) {
        this.logger.trace("discarding resolve", { clientId, messageId })
        value.dispose().catch((error) => this.logger.error(error.message))
      }
    } catch (error) {
      if (!disconnected()) {
        this.sendException(clientId, messageId, error)
      } else {
        this.logger.trace("discarding reject", { clientId, messageId, error: error.message })
      }
    }
  }

  /**
   * Send a callback to the client.
   */
  private sendCallback(clientId: number, proxyId: number | Module, callbackId: number, args: any[]): void {
    this.logger.trace("sending callback", { clientId, proxyId, callbackId })
    this.send<Message.Server.Callback>({
      type: Message.Server.Type.Callback,
      clientId,
      callbackId,
      proxyId,
      args: args.map((a) => this.encode(clientId, a)),
    })
  }

  /**
   * Store a proxy and bind events to send them back to the client.
   */
  private storeProxy(instance: ServerProxy, clientId: number): number
  private storeProxy(instance: ModuleProxy, moduleProxyId: Module): Module
  private storeProxy(instance: ServerProxy | ModuleProxy, clientOrModuleProxyId: Module | number): number | Module {
    this.logger.trace("storing proxy", { proxyId: clientOrModuleProxyId })

    if (isNonModuleProxy(instance)) {
      if (typeof clientOrModuleProxyId !== "number") {
        throw new Error("non-module proxies must have numerical IDs")
      }
      const proxyId = this.proxyId++
      instance.onEvent((event, ...args) => this.sendEvent(clientOrModuleProxyId, proxyId, event, ...args))
      instance.onDone(() => {
        const proxy = this.getProxy(proxyId, "Unable to dispose")
        this.sendEvent(clientOrModuleProxyId, proxyId, "done")
        proxy.disposeTimeout = setTimeout(() => {
          this.removeProxy(proxyId)
        }, this.responseTimeout)
      })
      this.proxies.set(proxyId, { clientId: clientOrModuleProxyId, instance })
      return proxyId
    }

    if (typeof clientOrModuleProxyId !== "string") {
      throw new Error("module proxies must have string IDs")
    }

    this.proxies.set(clientOrModuleProxyId, { instance })
    return clientOrModuleProxyId
  }

  /**
   * Send an event on a numbered proxy to the client that owns it.
   */
  private sendEvent(clientId: number, proxyId: number, event: string, ...args: any[]): void {
    this.logger.trace("sending event", () => ({
      clientId,
      proxyId,
      event,
      args: args.map((a) => (a instanceof Buffer ? a.toString() : a)),
    }))
    this.send<Message.Server.Event>({
      type: Message.Server.Type.Event,
      clientId,
      event,
      proxyId,
      args: args.map((a) => this.encode(clientId, a)),
    })
  }

  /**
   * Send a response back to the client.
   */
  private sendResponse(clientId: number, messageId: number, response: any): void {
    const encoded = this.encode(clientId, response)
    this.logger.trace("sending resolve", { clientId, messageId, response: encoded })
    this.send<Message.Server.Success>({
      type: Message.Server.Type.Success,
      clientId,
      messageId,
      response: encoded,
    })
  }

  /**
   * Send an exception back to the client.
   */
  private sendException(clientId: number, messageId: number, error: Error): void {
    this.logger.trace("sending reject", { clientId, messageId, message: error.message })
    this.send<Message.Server.Fail>({
      type: Message.Server.Type.Fail,
      clientId,
      messageId,
      response: this.encode(clientId, error),
    })
  }

  private isProxyData(p: ProxyData | ModuleProxyData): p is ProxyData {
    return isNonModuleProxy(p.instance)
  }

  /**
   * Dispose then remove a proxy. Module proxies are immune to removal unless
   * otherwise specified.
   */
  private async removeProxy(proxyId: number | Module, modules?: boolean, disconnect?: boolean): Promise<void> {
    const proxy = this.proxies.get(proxyId)
    if (!proxy) {
      throw new Error(`unable to remove: proxy ${proxyId} already removed`)
    }
    if (this.isProxyData(proxy)) {
      // If disconnected we don't want to send any more events.
      if (disconnect && !proxy.disconnected) {
        proxy.disconnected = true
        proxy.instance.instance.removeAllListeners()
      }
      if (!proxy.disposePromise) {
        clearTimeout(proxy.disposeTimeout as any)
        this.logger.trace("disposing proxy", { proxyId })
        proxy.disposePromise = proxy.instance
          .dispose()
          .then(() => this.logger.trace("disposed proxy", { proxyId }))
          .catch((error) => this.logger.error("failed to dispose proxy", { proxyId, error: error.message }))
          .finally(() => {
            this.proxies.delete(proxyId)
            this.logger.trace("removed proxy", { proxyId, proxies: this.proxies.size })
          })
      }
      await proxy.disposePromise
    } else if (modules) {
      this.proxies.delete(proxyId)
      this.logger.trace("removed proxy", { proxyId, proxies: this.proxies.size })
    }
  }

  /**
   * Same as encode but provides storeProxy.
   */
  private encode(clientId: number, value: any): Argument {
    return encode(value, undefined, (p) => this.storeProxy(p, clientId))
  }

  /**
   * Get a proxy. Error if it doesn't exist.
   */
  private getProxy(proxyId: number, message: string): ProxyData
  private getProxy(proxyId: Module, message: string): ModuleProxyData
  private getProxy(proxyId: number | Module, message: string): ProxyData | ModuleProxyData
  private getProxy(proxyId: number | Module, message: string): ProxyData | ModuleProxyData {
    const proxy = this.proxies.get(proxyId)
    if (!proxy || "disposePromise" in proxy) {
      throw new Error(`${message}: proxy ${proxyId} disposed too early`)
    }
    return proxy as any
  }

  private send<T extends Message.Server.Message>(message: T): void {
    if (this.status === ConnectionStatus.Connected) {
      this.connection.send(JSON.stringify(message))
    }
  }
}
