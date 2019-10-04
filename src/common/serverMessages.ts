import { Argument } from "./arguments"
import { Module } from "./proxy"

export enum Type {
  Callback = "callback",
  Event = "event",
  Fail = "fail",
  Init = "init",
  Pong = "pong",
  Success = "success",
}

export interface Callback {
  type: Type.Callback
  clientId: number
  callbackId: number
  proxyId: Module | number
  args: Argument[]
}

export interface Event {
  type: Type.Event
  clientId: number
  event: string
  proxyId: Module | number
  args: Argument[]
}

export interface Fail {
  type: Type.Fail
  clientId: number
  messageId: number
  response: Argument
}

export interface InitData {
  readonly env: NodeJS.ProcessEnv
  readonly os: {
    platform: NodeJS.Platform
    readonly homedir: string
    readonly eol: string
  }
}

export interface Init extends InitData {
  type: Type.Init
  clientId: number
}

export interface Pong {
  type: Type.Pong
  clientId: number
}

export interface Success {
  type: Type.Success
  clientId: number
  messageId: number
  response: Argument
}

export type Message = Callback | Event | Fail | Init | Pong | Success
