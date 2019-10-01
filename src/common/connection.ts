/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SendableConnection {
  send(data: string): void
}

export interface ReadWriteConnection extends SendableConnection {
  onMessage(cb: (data: string) => void): void
  onClose(cb: () => void): void
  onDown(cb: () => void): void
  onUp(cb: () => void): void
  close(): void
}

export type LoggerArgument = (() => Array<{ [key: string]: any }>) | { [key: string]: any }

export interface Logger {
  trace(message: string, ...args: LoggerArgument[]): void
  error(message: string, ...args: LoggerArgument[]): void
}

export class DefaultLogger implements Logger {
  public trace(message: string, ...args: LoggerArgument[]): void {
    if (typeof process !== "undefined" && process.env && process.env.LOG_LEVEL === "trace") {
      this.log("trace", message, ...args)
    }
  }

  public error(message: string, ...args: LoggerArgument[]): void {
    this.log("error", message, ...args)
  }

  private log(level: "error" | "trace", message: string, ...args: LoggerArgument[]): void {
    console.log(level, message, ...args.map((a) => (typeof a === "function" ? a() : a)))
  }
}
