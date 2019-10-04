import * as os from "os"
import { NotImplementedProxy } from "../common/proxy"
import * as Message from "../common/messages"

type NodeOs = typeof os

export class OsModule extends NotImplementedProxy implements Partial<NodeOs> {
  private data = {
    homedir: "",
    eol: "\n",
  }

  public constructor(initData: Promise<Message.Server.InitData>) {
    super("os")
    initData.then((data) => {
      this.data = { ...data.os }
    })
  }

  public homedir(): string {
    return this.data.homedir
  }

  public get EOL(): string {
    return this.data.eol
  }
}
