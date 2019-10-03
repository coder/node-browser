import * as os from "os"
import { NotImplementedProxy } from "../common/proxy"

type NodeOs = typeof os

export class OsModule extends NotImplementedProxy implements Partial<NodeOs> {
  public constructor() {
    super("os")
  }
}
