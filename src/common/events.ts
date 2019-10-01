import { EventEmitter as NodeEventEmitter } from "events"
import { Disposable } from "./util"

/* eslint-disable @typescript-eslint/no-non-null-assertion */

export interface Event<T> {
  (listener: (value: T) => void): Disposable
  (id: number | string, listener: (value: T) => void): Disposable
}

/**
 * Emitter typecasts for a single event type. You can optionally use IDs, but
 * using undefined with IDs will not work. If you emit without an ID, *all*
 * listeners regardless of their ID (or lack thereof) will receive the event.
 * Similarly, if you listen without an ID you will get *all* events for any or
 * no ID.
 */
export class Emitter<T> {
  private listeners: Array<(value: T) => void> = []
  private readonly idListeners = new Map<number | string, Array<(value: T) => void>>()

  public get event(): Event<T> {
    return (id: number | string | ((value: T) => void), cb?: (value: T) => void): Disposable => {
      if (typeof id !== "function") {
        if (this.idListeners.has(id)) {
          this.idListeners.get(id)!.push(cb!)
        } else {
          this.idListeners.set(id, [cb!])
        }

        return {
          dispose: (): void => {
            if (this.idListeners.has(id)) {
              const cbs = this.idListeners.get(id)!
              const i = cbs.indexOf(cb!)
              if (i !== -1) {
                cbs.splice(i, 1)
              }
            }
          },
        }
      }

      cb = id
      this.listeners.push(cb)

      return {
        dispose: (): void => {
          const i = this.listeners.indexOf(cb!)
          if (i !== -1) {
            this.listeners.splice(i, 1)
          }
        },
      }
    }
  }

  /**
   * Emit an event with a value.
   */
  public emit(value: T): void
  public emit(id: number | string, value: T): void
  public emit(id: number | string | T, value?: T): void {
    if ((typeof id === "number" || typeof id === "string") && typeof value !== "undefined") {
      if (this.idListeners.has(id)) {
        this.idListeners.get(id)!.forEach((cb) => cb(value!))
      }
      this.listeners.forEach((cb) => cb(value!))
    } else {
      this.idListeners.forEach((cbs) => cbs.forEach((cb) => cb((id as T)!)))
      this.listeners.forEach((cb) => cb((id as T)!))
    }
  }

  /**
   * Dispose the current events.
   */
  public dispose(): void
  public dispose(id: number | string): void
  public dispose(id?: number | string): void {
    if (typeof id !== "undefined") {
      this.idListeners.delete(id)
    } else {
      this.listeners = []
      this.idListeners.clear()
    }
  }

  public get counts(): { [key: string]: number } {
    const counts: { [key: string]: number } = {}
    if (this.listeners.length > 0) {
      counts["n/a"] = this.listeners.length
    }
    this.idListeners.forEach((cbs, id) => {
      if (cbs.length > 0) {
        counts[`${id}`] = cbs.length
      }
    })

    return counts
  }
}

type EventArg = any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A replacement for Node's event emitter.
 */
export class EventEmitter implements NodeEventEmitter {
  private readonly _listeners = new Map<string | symbol, Array<(...args: EventArg[]) => void>>()

  // Insanity but it fulfills the types when creating a net.Server.
  public static EventEmitter = EventEmitter

  public static listenerCount(): number {
    throw new Error("deprecated")
  }
  public static get defaultMaxListeners(): number {
    throw new Error("deprecated")
  }

  public on(event: string | symbol, listener: (...args: EventArg[]) => void): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, [])
    }
    this._listeners.get(event)!.push(listener)
    return this
  }

  public addListener(event: string | symbol, listener: (...args: EventArg[]) => void): this {
    return this.on(event, listener)
  }

  public once(event: string | symbol, listener: (...args: EventArg[]) => void): this {
    const cb = (...args: EventArg[]): void => {
      this.off(event, cb)
      listener(...args)
    }
    this.on(event, cb)
    return this
  }

  public prependListener(): this {
    throw new Error("not implemented")
  }
  public prependOnceListener(): this {
    throw new Error("not implemented")
  }

  public removeListener(event: string | symbol, listener: (...args: EventArg[]) => void): this {
    return this.off(event, listener)
  }

  public off(event: string | symbol, listener: (...args: EventArg[]) => void): this {
    const listeners = this._listeners.get(event)
    if (listeners) {
      const i = listeners.indexOf(listener)
      if (i !== -1) {
        listeners.splice(i, 1)
      }
    }
    return this
  }

  public removeAllListeners(event?: string | symbol): this {
    if (event) {
      this._listeners.delete(event)
    } else {
      this._listeners.clear()
    }
    return this
  }

  public setMaxListeners(): this {
    throw new Error("not implemented")
  }
  public getMaxListeners(): number {
    throw new Error("not implemented")
  }
  public listeners(): Function[] {
    throw new Error("not implemented")
  }
  public rawListeners(): Function[] {
    throw new Error("not implemented")
  }

  public emit(event: string | symbol, ...args: EventArg[]): boolean {
    const listeners = this._listeners.get(event)
    if (listeners) {
      listeners.forEach((listener) => listener(...args))
      return true
    }
    return false
  }

  public eventNames(): Array<string | symbol> {
    throw new Error("not implemented")
  }
  public listenerCount(): number {
    throw new Error("not implemented")
  }
}
