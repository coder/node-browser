import * as assert from "assert"
import { EventEmitter } from "events"
import * as fs from "fs"
import * as util from "util"
import { encode, decode } from "../src/common/arguments"
import { ServerProxy } from "../src/common/proxy"

class TestProxy extends ServerProxy {
  public constructor(public readonly id: string) {
    super({
      bindEvents: [],
      doneEvents: [],
      instance: new EventEmitter(),
    })
  }
}

describe("Convert", () => {
  it("should convert nothing", () => {
    assert.equal(decode(), undefined)
  })

  it("should convert null", () => {
    assert.equal(decode(encode(null)), null)
  })

  it("should convert undefined", () => {
    assert.equal(decode(encode(undefined)), undefined)
  })

  it("should convert string", () => {
    assert.equal(decode(encode("test")), "test")
  })

  it("should convert number", () => {
    assert.equal(decode(encode(10)), 10)
  })

  it("should convert boolean", () => {
    assert.equal(decode(encode(true)), true)
    assert.equal(decode(encode(false)), false)
  })

  it("should convert error", () => {
    const error = new Error("message")
    const convertedError = decode(encode(error))

    assert.equal(convertedError instanceof Error, true)
    assert.equal(convertedError.message, "message")
  })

  it("should convert buffer", async () => {
    const buffer = await util.promisify(fs.readFile)(__filename)
    assert.equal(buffer instanceof Buffer, true)

    const convertedBuffer = decode(encode(buffer))
    assert.equal(convertedBuffer instanceof Buffer, true)
    assert.equal(convertedBuffer.toString(), buffer.toString())
  })

  it("should convert proxy", () => {
    let i = 0
    const proto = encode({ onEvent: (): void => undefined }, undefined, () => i++)
    const proxy = decode(proto, undefined, (id) => new TestProxy(`created: ${id}`))
    assert.equal(proxy.id, "created: 0")
  })

  it("should convert function", () => {
    const called: any[] = []
    const map = new Map<number, (...args: any[]) => void>()
    let i = 0
    const encoded = encode(
      (...v: any[]) => called.push(...v),
      (f) => {
        map.set(i++, f)
        return i - 1
      }
    )

    const remoteFn = decode(encoded, (id, args) => {
      map.get(id)!(...args)
    })

    remoteFn("a", "b", 1)

    assert.equal(called.length, 3)
    assert.deepEqual(called, ["a", "b", 1])
  })

  it("should convert array", () => {
    const array = ["a", "b", 1, [1, "a"], null, undefined]
    assert.deepEqual(decode(encode(array)), array)
  })

  it("should convert object", () => {
    const obj = { a: "test" }
    // const obj = { "a": 1, "b": [1, "a"], test: null, test2: undefined };
    assert.deepEqual(decode(encode(obj)), obj)
  })
})
