import { Argument } from "./arguments"
import { Module } from "./proxy"

export enum Type {
  Proxy = "proxy",
  Ping = "ping",
  Handshake = "handshake",
}

export interface Proxy {
  type: Type.Proxy
  clientId: number
  messageId: number
  proxyId: Module | number
  method: string
  args: Argument[]
}

export interface Ping {
  type: Type.Ping
  clientId: number
}

export interface Handshake {
  type: Type.Handshake
  clientId: number
}

export type Message = Proxy | Ping | Handshake
