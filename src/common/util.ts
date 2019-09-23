import { ClientServerProxy, ServerProxy } from "./proxy"

export const isProxy = <P = ClientServerProxy | ServerProxy>(value: any): value is P => {
  return value && typeof value === "object" && typeof value.onEvent === "function"
}

export const isPromise = (value: any): value is Promise<any> => {
  return typeof value.then === "function" && typeof value.catch === "function"
}

export const withEnv = <T extends { env?: NodeJS.ProcessEnv }>(options?: T): T => {
  return options && options.env
    ? {
        ...options,
        env: {
          ...process.env,
          ...options.env,
        },
      }
    : options || ({} as T)
}

export interface Disposable {
  dispose: () => void
}
