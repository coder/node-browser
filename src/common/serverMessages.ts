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
  callbackId: number
  proxyId: Module | number
  args: Argument[]
}

export interface Event {
  type: Type.Event
  event: string
  proxyId: Module | number
  args: Argument[]
}

export interface Fail {
  type: Type.Fail
  messageId: number
  response: Argument
}

export interface InitData {
  readonly os: NodeJS.Platform
}

export interface Init extends InitData {
  type: Type.Init
}

export interface Pong {
  type: Type.Pong
}

export interface Success {
  type: Type.Success
  messageId: number
  response: Argument
}

export type Message = Callback | Event | Fail | Init | Pong | Success
