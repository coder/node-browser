import "leaked-handles"
import * as assert from "assert"
import * as nativeNet from "net"
import { Module } from "../src/common/proxy"
import { createClient, Helper } from "./helpers"

describe("net", () => {
  const client = createClient()
  const net = client.modules[Module.Net]
  const helper = new Helper("net")

  before(async () => {
    await helper.prepare()
  })

  describe("Socket", () => {
    const socketPath = helper.tmpFile()
    let server: nativeNet.Server

    before(async () => {
      await new Promise((r): void => {
        server = nativeNet.createServer().listen(socketPath, r)
      })
    })

    after(() => {
      server.close()
    })

    it("should fail to connect", async () => {
      const socket = new net.Socket()

      const called: any[] = []
      socket.on("error", (v) => called.push(v))

      socket.connect("/tmp/t/e/s/t/d/o/e/s/n/o/t/e/x/i/s/t")

      await new Promise((r): nativeNet.Socket => socket.on("close", r))

      assert.equal(called.length, 1)
    })

    it("should remove event listener", async () => {
      const socket = new net.Socket()

      const called: any[] = []
      const called2: any[] = []

      const on = (v: Error) => called.push(v)
      socket.on("error", on)
      socket.on("error", (v) => called2.push(v))
      socket.off("error", on)

      socket.connect("/tmp/t/e/s/t/d/o/e/s/n/o/t/e/x/i/s/t")

      await new Promise((r): nativeNet.Socket => socket.on("close", r))
      assert.equal(called.length, 0)
      assert.equal(called2.length, 1)
    })

    it("should connect", async () => {
      await new Promise((resolve): void => {
        const socket = net.createConnection(socketPath, () => {
          socket.end()
          socket.addListener("close", () => {
            resolve()
          })
        })
      })

      await new Promise((resolve): void => {
        const socket = new net.Socket()
        socket.connect(socketPath, () => {
          socket.end()
          socket.addListener("close", () => {
            resolve()
          })
        })
      })
    })

    it("should get data", (done) => {
      server.once("connection", (socket: nativeNet.Socket) => {
        socket.write("hi how r u")
      })

      const socket = net.createConnection(socketPath)

      socket.addListener("data", (data) => {
        assert.equal(data.toString(), "hi how r u")
        socket.end()
        socket.addListener("close", () => {
          done()
        })
      })
    })

    it("should send data", (done) => {
      const clientSocket = net.createConnection(socketPath)
      clientSocket.write(Buffer.from("bananas"))
      server.once("connection", (socket: nativeNet.Socket) => {
        socket.addListener("data", (data) => {
          assert.equal(data.toString(), "bananas")
          socket.end()
          clientSocket.addListener("end", () => {
            done()
          })
        })
      })
    })
  })

  describe("Server", () => {
    it("should listen", (done) => {
      const s = net.createServer()
      s.on("listening", () => s.close())
      s.on("close", () => done())
      s.listen(helper.tmpFile())
    })

    it("should get connection", async () => {
      let constructorListener: (() => void) | undefined
      const s = net.createServer(() => {
        if (constructorListener) {
          constructorListener()
        }
      })

      const socketPath = helper.tmpFile()
      s.listen(socketPath)

      await new Promise((resolve): void => {
        s.on("listening", resolve)
      })

      const makeConnection = async (): Promise<void> => {
        net.createConnection(socketPath)
        await Promise.all([
          new Promise((resolve): void => {
            constructorListener = resolve
          }),
          new Promise((resolve): void => {
            s.once("connection", (socket) => {
              socket.destroy()
              resolve()
            })
          }),
        ])
      }

      await makeConnection()
      await makeConnection()

      s.close()
      await new Promise((r): nativeNet.Server => s.on("close", r))
    })
  })

  describe("cleanup", () => {
    it("should dispose", (done) => {
      setTimeout(() => {
        client.dispose()
        done()
      }, 100)
    })
  })
})
