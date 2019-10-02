import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as rimraf from "rimraf"
import * as util from "util"
import { Client } from "../src/client/client"
import { Emitter } from "../src/common/events"
import { Disposable } from "../src/common/util"
import { Server, ServerOptions } from "../src/server/server"
import { ReadWriteConnection, Logger } from "../src/common/connection"

// So we only make the directory once when running multiple tests.
let mkdirPromise: Promise<void> | undefined

export class Helper {
  private i = 0
  public coderDir: string
  private baseDir = path.join(os.tmpdir(), "coder")

  public constructor(directoryName: string) {
    if (!directoryName.trim()) {
      throw new Error("no directory name")
    }

    this.coderDir = path.join(this.baseDir, directoryName)
  }

  public tmpFile(): string {
    return path.join(this.coderDir, `${this.i++}`)
  }

  public async createTmpFile(): Promise<string> {
    const tf = this.tmpFile()
    await util.promisify(fs.writeFile)(tf, "")

    return tf
  }

  public async prepare(): Promise<void> {
    if (!mkdirPromise) {
      mkdirPromise = util
        .promisify(fs.mkdir)(this.baseDir)
        .catch((error) => {
          if (error.code !== "EEXIST" && error.code !== "EISDIR") {
            throw error
          }
        })
    }
    await mkdirPromise
    await util.promisify(rimraf)(this.coderDir)
    await util.promisify(fs.mkdir)(this.coderDir)
  }
}

interface TestConnection extends ReadWriteConnection {
  close(): void
  down(): void
  up(): void
}

export class TestClient extends Client {
  public constructor(private readonly _connection: TestConnection, logger?: Logger) {
    super(_connection, logger)
  }

  public dispose(): void {
    this._connection.close()
  }

  public down(): void {
    this._connection.down()
  }

  public up(): void {
    this._connection.up()
  }
}

export const createClient = (serverOptions?: ServerOptions): TestClient => {
  const s2c = new Emitter<string>()
  const c2s = new Emitter<string>()
  const closeCallbacks = [] as Array<() => void>
  const downCallbacks = [] as Array<() => void>
  const upCallbacks = [] as Array<() => void>

  new Server(
    {
      onDown: (cb: () => void): number => downCallbacks.push(cb),
      onUp: (cb: () => void): number => upCallbacks.push(cb),
      onClose: (cb: () => void): number => closeCallbacks.push(cb),
      onMessage: (cb): Disposable => c2s.event((d) => cb(d)),
      send: (data): NodeJS.Timer => setTimeout(() => s2c.emit(data), 0),
    },
    serverOptions
  )

  const client = new TestClient({
    close: (): void => closeCallbacks.forEach((cb) => cb()),
    down: (): void => downCallbacks.forEach((cb) => cb()),
    up: (): void => upCallbacks.forEach((cb) => cb()),
    onDown: (cb: () => void): number => downCallbacks.push(cb),
    onUp: (cb: () => void): number => upCallbacks.push(cb),
    onClose: (cb: () => void): number => closeCallbacks.push(cb),
    onMessage: (cb): Disposable => s2c.event((d) => cb(d)),
    send: (data): NodeJS.Timer => setTimeout(() => c2s.emit(data), 0),
  })

  return client
}

type Argument = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Fn = (...args: Argument[]) => void
export interface TestFn extends Fn {
  called: number
  args: Argument[]
}

export const testFn = (): TestFn => {
  const test = (...args: Argument[]): void => {
    ++test.called
    test.args.push(args.length === 1 ? args[0] : args)
  }

  test.called = 0
  test.args = [] as Argument[]

  return test
}
