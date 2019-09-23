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
