import * as os from "os"
import { field, logger } from "@coder/logger"
import { ReadWriteConnection } from "../common/connection"
import * as Message from "../common/messages"
import { Module, ServerProxy } from "../common/proxy"
import { isPromise, isProxy } from "../common/util"
import { Argument, encode, decode } from "../common/arguments"
import { ChildProcessModuleProxy, ForkProvider } from "./child_process"
import { FsModuleProxy } from "./fs"
import { NetModuleProxy } from "./net"

export interface ServerOptions {
  readonly fork?: ForkProvider
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
  private disconnected = false
  private readonly responseTimeout = 10000

  public constructor(private readonly connection: ReadWriteConnection, private readonly options?: ServerOptions) {
    connection.onMessage(async (data) => {
      try {
        await this.handleMessage(JSON.parse(data))
      } catch (error) {
        logger.error("Failed to handle client message", field("error", error.message))
      }
    })

    connection.onClose(() => {
      this.disconnected = true
      logger.trace(() => ["disconnected from client", field("proxies", this.proxies.size)])
      this.proxies.forEach((proxy, proxyId) => {
        if (isProxy(proxy.instance)) {
          proxy.instance.dispose().catch((error) => {
            logger.error(error.message)
          })
        }
        this.removeProxy(proxyId)
      })
    })

    this.storeProxy(new ChildProcessModuleProxy(this.options ? this.options.fork : undefined), Module.ChildProcess)
    this.storeProxy(new FsModuleProxy(), Module.Fs)
    this.storeProxy(new NetModuleProxy(), Module.Net)

    connection.send(
      JSON.stringify(<Message.Server.Init>{
        type: Message.Server.Type.Init,
        os: os.platform(),
      })
    )
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
        logger.trace("ping")
        this.connection.send(
          JSON.stringify(<Message.Server.Pong>{
            type: Message.Server.Type.Pong,
          })
        )
        break
      default:
        throw new Error("unknown message type")
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
      return decode(
        a,
        (id, args) => this.sendCallback(proxyId, id, args),
        (id) => this.getProxy(id).instance
      )
    })

    logger.trace(
      "received",
      field("messageId", messageId),
      field("proxyId", proxyId),
      field("method", method),
      field("args", args),
    )

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
      logger.error(error.message, field("type", typeof response), field("proxyId", proxyId))
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
    logger.trace(() => ["sending callback", field("proxyId", proxyId), field("callbackId", callbackId)])
    this.connection.send(
      JSON.stringify(<Message.Server.Callback>{
        type: Message.Server.Type.Callback,
        callbackId,
        proxyId,
        args: args.map((a) => this.encode(a)),
      })
    )
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
    if (this.disconnected) {
      if (isProxy(instance)) {
        instance.dispose().catch((error) => {
          logger.error(error.message)
        })
      }

      throw new Error("disposed")
    }

    const proxyId = moduleProxyId || this.proxyId++
    logger.trace(() => ["storing proxy", field("proxyId", proxyId)])

    this.proxies.set(proxyId, { instance })

    if (isProxy(instance)) {
      instance.onEvent((event, ...args) => this.sendEvent(proxyId, event, ...args))
      instance.onDone(() => {
        // It might have finished because we disposed it due to a disconnect.
        if (!this.disconnected) {
          this.sendEvent(proxyId, "done")
          this.getProxy(proxyId).disposeTimeout = setTimeout(() => {
            instance.dispose().catch((error) => {
              logger.error(error.message)
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
    logger.trace(() => [
      "sending event",
      field("proxyId", proxyId),
      field("event", event),
      field("args", args.map((a) => a instanceof Buffer ? a.toString() : a))
    ])
    this.connection.send(
      JSON.stringify(<Message.Server.Event>{
        type: Message.Server.Type.Event,
        event,
        proxyId,
        args: args.map((a) => this.encode(a)),
      })
    )
  }

  /**
   * Send a response back to the client.
   */
  private sendResponse(messageId: number, response: any): void {
    const encoded = this.encode(response)
    logger.trace(
      "sending resolve",
      field("messageId", messageId),
      field("response", encoded)
    )
    this.connection.send(
      JSON.stringify(<Message.Server.Success>{
        type: Message.Server.Type.Success,
        messageId,
        response: encoded,
      })
    )
  }

  /**
   * Send an exception back to the client.
   */
  private sendException(messageId: number, error: Error): void {
    logger.trace(
      "sending reject",
      field("messageId", messageId),
      field("message", error.message),
    )
    this.connection.send(
      JSON.stringify(<Message.Server.Fail>{
        type: Message.Server.Type.Fail,
        messageId,
        response: this.encode(error),
      })
    )
  }

  /**
   * Call after disposing a proxy.
   */
  private removeProxy(proxyId: number | Module): void {
    clearTimeout(this.getProxy(proxyId).disposeTimeout as any)
    this.proxies.delete(proxyId)
    logger.trace(() => ["disposed and removed proxy", field("proxyId", proxyId), field("proxies", this.proxies.size)])
  }

  /**
   * Same as argumentToProto but provides storeProxy.
   */
  private encode(value: any): Argument {
    return encode(value, undefined, (p) => this.storeProxy(p))
  }

  /**
   * Get a proxy. Error if it doesn't exist.
   */
  private getProxy(proxyId: number | Module): ProxyData {
    if (!this.proxies.has(proxyId)) {
      throw new Error(`proxy ${proxyId} disposed too early`)
    }
    return this.proxies.get(proxyId)!
  }
}
