import { NotImplementedProxy } from "../common/proxy"

type NodeProcess = typeof process

export class ProcessModule extends NotImplementedProxy implements Partial<NodeProcess> {
  public constructor() {
    super("process")
  }
}
