import "leaked-handles"
import * as assert from "assert"
import { ChildProcess } from "child_process"
import * as os from "os"
import * as path from "path"
import { Readable } from "stream"
import { Module } from "../src/common/proxy"
import { createClient, testFn } from "./helpers"

describe("child_process", () => {
  const client = createClient()
  const cp = (client.modules[Module.ChildProcess] as any) as typeof import("child_process") // eslint-disable-line @typescript-eslint/no-explicit-any
  const util = client.modules[Module.Util]

  const getStdout = async (proc: ChildProcess): Promise<string> => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new Promise<Buffer>((r): Readable => proc.stdout!.once("data", r)).then((s) => s.toString())
  }

  describe("handshake", () => {
    it("should get init data", async () => {
      const data = await client.handshake()
      assert.equal(data.os.platform, os.platform())
      assert.deepEqual(data.env, process.env)
    })
  })

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
      const result = await Promise.all([getStdout(proc), new Promise((r): ChildProcess => proc.on("exit", r))]).then(
        (values) => values[0]
      )
      assert.equal(result, "test\n")
    })

    it("should cat stdin", async () => {
      const proc = cp.spawn("cat", [])
      assert.equal(proc.pid, -1)
      proc.stdin.write("banana")
      const result = await getStdout(proc)
      assert.equal(result, "banana")

      proc.stdin.end()
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
      const fn = testFn()
      proc.on("error", fn)

      proc.send({ bananas: true })
      const result = await new Promise((r): ChildProcess => proc.on("message", r))
      assert.deepEqual(result, { bananas: true })

      client.dispose()
      assert.equal(fn.called, 1)
      assert.equal(fn.args.length, 1)
      assert.equal(fn.args[0].message, "disconnected")
    })
  })

  describe("resiliency", () => {
    it("should handle multiple clients", async () => {
      const clients = createClient(3)
      const procs = clients.map((client, i) => {
        return client.modules[Module.ChildProcess].spawn("/bin/bash", ["-c", `echo -n hello: ${i}`])
      })

      const done = Promise.all(procs.map((p) => new Promise((r): ChildProcess => p.on("exit", r))))
      const stdout = await Promise.all(procs.map(getStdout))

      for (let i = 0; i < stdout.length; ++i) {
        assert.equal(stdout[i], `hello: ${i}`)
      }

      await done
      clients.forEach((c) => c.dispose())
    })

    it("should exit if connection drops while in use", async () => {
      const client = createClient()
      const proc = client.modules[Module.ChildProcess].spawn("/bin/bash", ["-c", "sleep inf"])
      setTimeout(() => {
        client.down()
      }, 200)
      await new Promise((r): ChildProcess => proc.on("exit", r))
      client.dispose()
    })

    it("should exit if connection drops briefly", async () => {
      const client = createClient()
      const proc = client.modules[Module.ChildProcess].spawn("/bin/bash", ["-c", "sleep inf"])
      setTimeout(() => {
        client.down()
        client.up()
      }, 200)
      await new Promise((r): ChildProcess => proc.on("exit", r))
      client.dispose()
    })
  })
})
