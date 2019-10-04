import { NotImplementedProxy } from "../common/proxy"

type NodeProcess = typeof process

export class ProcessModule extends NotImplementedProxy implements Partial<NodeProcess> {
  public constructor() {
    super("process")
  }

  public get env(): NodeJS.ProcessEnv {
    return {}
  }

  public get argv(): string[] {
    return []
  }

  public get stdout(): undefined {
    return undefined
  }

  public get stderr(): undefined {
    return undefined
  }

  public get platform(): undefined {
    return undefined
  }
}
