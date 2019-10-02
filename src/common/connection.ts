/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SendableConnection {
  send(data: string): void
}

export interface ReadWriteConnection extends SendableConnection {
  /**
   * Message received from the connection.
   */
  onMessage(cb: (data: string) => void): void
  /**
   * Indicates permanent closure, meaning we should dispose.
   */
  onClose(cb: () => void): void
  /**
   * Connection is temporarily down.
   */
  onDown(cb: () => void): void
  /**
   * Connection is back up.
   */
  onUp(cb: () => void): void
}

export type LoggerArgument = (() => Array<{ [key: string]: any }>) | { [key: string]: any }

export interface Logger {
  trace(message: string, ...args: LoggerArgument[]): void
  error(message: string, ...args: LoggerArgument[]): void
}

export class DefaultLogger implements Logger {
  public constructor(private readonly name: string) {}

  public trace(message: string, ...args: LoggerArgument[]): void {
    if (typeof process !== "undefined" && process.env && process.env.LOG_LEVEL === "trace") {
      this.log(message, ...args)
    }
  }

  public error(message: string, ...args: LoggerArgument[]): void {
    this.log(message, ...args)
  }

  private log(message: string, ...args: LoggerArgument[]): void {
    console.log(`[${this.name}]`, message, ...args.map((a) => JSON.stringify(typeof a === "function" ? a() : a)))
  }
}

export enum ConnectionStatus {
  Disconnected,
  Connected,
  Closed, // This status is permanent.
}
