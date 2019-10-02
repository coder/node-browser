import { Argument } from "./arguments"
import { Module } from "./proxy"

export enum Type {
  Proxy = "proxy",
  Ping = "ping",
}

export interface Proxy {
  type: Type.Proxy
  messageId: number
  proxyId: Module | number
  method: string
  args: Argument[]
}

export interface Ping {
  type: Type.Ping
}

export type Message = Proxy | Ping
