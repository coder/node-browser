import * as assert from "assert";
import { ChildProcess } from "child_process"
import * as path from "path"
import { Readable } from "stream"
import * as util from "util"
import { Module } from "../src/common/proxy"
import { createClient } from "./helpers"

describe("child_process", () => {
  const client = createClient()
  const cp = client.modules[Module.ChildProcess] as any as typeof import("child_process")

  const getStdout = async (proc: ChildProcess): Promise<string> => {
    return new Promise<Buffer>((r): Readable => proc.stdout!.once("data", r)).then((s) => s.toString())
  }

  describe("exec", () => {
    it("should get exec stdout", async () => {
      const result = await util.promisify(cp.exec)("echo test", { encoding: "utf8" })
      assert.deepEqual(result, {
        stdout: "test\n",
        stderr: "",
      })
    })
  })

  describe("spawn", () => {
    it("should get spawn stdout", async () => {
      const proc = cp.spawn("echo", ["test"])
      const result = await Promise.all([getStdout(proc), new Promise((r): ChildProcess => proc.on("exit", r))]).then((values) => values[0])
      assert.equal(result, "test\n")
    })

    it("should cat stdin", async () => {
      const proc = cp.spawn("cat", [])
      assert.equal(proc.pid, -1)
      proc.stdin!.write("banana")
      const result = await getStdout(proc)
      assert.equal(result, "banana")

      proc.stdin!.end()
      proc.kill()

      assert.equal(proc.pid > -1, true)
      await new Promise((r): ChildProcess => proc.on("exit", r))
    })

    it("should print env", async () => {
      const proc = cp.spawn("env", [], {
        env: { hi: "donkey" },
      })

      const stdout = await getStdout(proc)
      assert.equal(stdout.includes("hi=donkey\n"), true)
    })

    it("should eval", async () => {
      const proc = cp.spawn("node", ["-e", "console.log('foo')"])
      const stdout = await getStdout(proc)
      assert.equal(stdout.includes("foo"), true)
    })
  })

  describe("fork", () => {
    it("should echo messages", async () => {
      const proc = cp.fork(path.join(__dirname, "forker.js"))

      proc.send({ bananas: true })
      const result = await new Promise((r): ChildProcess => proc.on("message", r))
      assert.deepEqual(result, { bananas: true })

      proc.kill()

      await new Promise((r): ChildProcess => proc.on("exit", r))
    })
  })

  describe("cleanup", () => {
    it("should dispose", (done) => {
      setTimeout(() => {
        client.dispose()
        done()
      }, 100)
    })

    it("should disconnect", async () => {
      const client = createClient()
      const cp = client.modules[Module.ChildProcess]
      const proc = cp.fork(path.join(__dirname, "forker.js"))
      let called: Error[] = [];
      proc.on("error", (error: Error) => {
        called.push(error)
      })

      proc.send({ bananas: true })
      const result = await new Promise((r): ChildProcess => proc.on("message", r))
      assert.deepEqual(result, { bananas: true })

      client.dispose()
      assert.equal(called.length, 1)
      assert.equal(called[0].message, "disconnected")
    })
  })
})
