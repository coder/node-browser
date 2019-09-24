import { ClientServerProxy, Module, ServerProxy } from "./proxy"
import { isProxy } from "./util"

/* eslint-disable @typescript-eslint/no-explicit-any */

enum Type {
  Array,
  Buffer,
  Date,
  Error,
  Function,
  Object,
  Proxy,
  Undefined,
}

interface EncodedArray {
  type: Type.Array
  values: Argument[]
}
interface EncodedBuffer {
  type: Type.Buffer
  data: Uint8Array
}
interface EncodedDate {
  type: Type.Date
  date: string
}
interface EncodedError {
  type: Type.Error
  code: string | undefined
  message: string
  stack: string | undefined
}
interface EncodedFunction {
  type: Type.Function
  id: number
}
interface EncodedObject {
  type: Type.Object
  values: { [key: string]: Argument }
}
interface EncodedProxy {
  type: Type.Proxy
  id: number
}
interface EncodedUndefined {
  // undefined must be explicitly encoded because converting to JSON will strip
  // it or turn it into null in some cases.
  type: Type.Undefined
}

export type Argument =
  | EncodedArray
  | EncodedBuffer
  | EncodedDate
  | EncodedError
  | EncodedFunction
  | EncodedObject
  | EncodedProxy
  | EncodedUndefined
  | string
  | number
  | boolean
  | null

/**
 * Convert an argument for serialization.
 * If sending a function is possible, provide `storeFunction`.
 * If sending a proxy is possible, provide `storeProxy`.
 */
export const encode = <P = ClientServerProxy | ServerProxy>(
  value: any,
  storeFunction?: (fn: () => void) => number,
  storeProxy?: (proxy: P) => number | Module
): Argument => {
  const convert = (currentValue: any): Argument => {
    if (isProxy<P>(currentValue)) {
      if (!storeProxy) {
        throw new Error("no way to serialize proxy")
      }
      const id = storeProxy(currentValue)
      if (typeof id === "string") {
        throw new Error("unable to serialize module proxy")
      }
      return { type: Type.Proxy, id } as EncodedProxy
    } else if (
      currentValue instanceof Error ||
      (currentValue && typeof currentValue.message !== "undefined" && typeof currentValue.stack !== "undefined")
    ) {
      return {
        type: Type.Error,
        code: currentValue.code,
        message: currentValue.message,
        stack: currentValue.stack,
      } as EncodedError
    } else if (currentValue instanceof Uint8Array || currentValue instanceof Buffer) {
      return { type: Type.Buffer, data: currentValue } as EncodedBuffer
    } else if (Array.isArray(currentValue)) {
      return { type: Type.Array, values: currentValue.map(convert) } as EncodedArray
    } else if (currentValue instanceof Date || (currentValue && typeof currentValue.getTime === "function")) {
      return { type: Type.Date, date: currentValue.toString() }
    } else if (currentValue !== null && typeof currentValue === "object") {
      const values: { [key: string]: Argument } = {}
      Object.keys(currentValue).forEach((key) => {
        values[key] = convert(currentValue[key])
      })
      return { type: Type.Object, values } as EncodedObject
    } else if (currentValue === null) {
      return currentValue
    }
    switch (typeof currentValue) {
      case "undefined":
        return { type: Type.Undefined } as EncodedUndefined
      case "function":
        if (!storeFunction) {
          throw new Error("no way to serialize function")
        }
        return { type: Type.Function, id: storeFunction(currentValue) } as EncodedFunction
      case "number":
      case "string":
      case "boolean":
        return currentValue
    }
    throw new Error(`cannot convert ${typeof currentValue} to encoded argument`)
  }

  return convert(value)
}

/**
 * Decode arguments into their original values.
 * If running a remote callback is supported, provide `runCallback`.
 * If using a remote proxy is supported, provide `createProxy`.
 */
export const decode = (
  argument?: Argument,
  runCallback?: (id: number, args: any[]) => void,
  createProxy?: (id: number) => ServerProxy
): any => {
  const convert = (currentArgument: Argument): any => {
    switch (typeof currentArgument) {
      case "number":
      case "string":
      case "boolean":
        return currentArgument
    }
    if (currentArgument === null) {
      return currentArgument
    }
    switch (currentArgument.type) {
      case Type.Array:
        return currentArgument.values.map(convert)
      case Type.Buffer:
        return Buffer.from((currentArgument as EncodedBuffer).data)
      case Type.Date:
        return new Date((currentArgument as EncodedDate).date)
      case Type.Error: {
        const error = new Error((currentArgument as EncodedError).message)
        ;(error as NodeJS.ErrnoException).code = (currentArgument as EncodedError).code
        ;(error as any).originalStack = (currentArgument as EncodedError).stack
        return error
      }
      case Type.Function:
        if (!runCallback) {
          throw new Error("no way to run remote callback")
        }
        return (...args: any[]): void => {
          return runCallback((currentArgument as EncodedFunction).id, args)
        }
      case Type.Object: {
        const obj: { [Key: string]: any } = {}
        Object.keys((currentArgument as EncodedObject).values).forEach((key) => {
          obj[key] = convert((currentArgument as EncodedObject).values[key])
        })
        return obj
      }
      case Type.Proxy:
        if (!createProxy) {
          throw new Error("no way to create proxy")
        }
        return createProxy((currentArgument as EncodedProxy).id)
      case Type.Undefined:
        return undefined
    }
    throw new Error("cannot convert unexpected encoded argument to value")
  }

  return argument && convert(argument)
}
