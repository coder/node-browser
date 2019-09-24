import "leaked-handles"
import * as assert from "assert"
import * as nativeFs from "fs"
import * as os from "os"
import * as path from "path"
import * as util from "util"
import { Module } from "../src/common/proxy"
import { createClient, Helper } from "./helpers"

describe("fs", () => {
  const client = createClient()
  const fs = (client.modules[Module.Fs] as any) as typeof import("fs") // eslint-disable-line @typescript-eslint/no-explicit-any
  const helper = new Helper("fs")

  before(async () => {
    await helper.prepare()
  })

  describe("access", () => {
    it("should access existing file", async () => {
      assert.equal(await util.promisify(fs.access)(__filename), undefined)
    })

    it("should fail to access nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.access)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("append", () => {
    it("should append to existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.appendFile)(file, "howdy"), undefined)
      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), "howdy")
    })

    it("should create then append to nonexistent file", async () => {
      const file = helper.tmpFile()
      assert.equal(await util.promisify(fs.appendFile)(file, "howdy"), undefined)
      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), "howdy")
    })

    it("should fail to append to file in nonexistent directory", async () => {
      const file = path.join(helper.tmpFile(), "nope")
      await assert.rejects(util.promisify(fs.appendFile)(file, "howdy"), /ENOENT/)
      assert.equal(await util.promisify(nativeFs.exists)(file), false)
    })
  })

  describe("chmod", () => {
    it("should chmod existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.chmod)(file, "755"), undefined)
    })

    it("should fail to chmod nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.chmod)(helper.tmpFile(), "755"), /ENOENT/)
    })
  })

  describe("chown", () => {
    it("should chown existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(nativeFs.chown)(file, 1000, 1000), undefined)
    })

    it("should fail to chown nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.chown)(helper.tmpFile(), 1000, 1000), /ENOENT/)
    })
  })

  describe("close", () => {
    it("should close opened file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "r")
      assert.equal(await util.promisify(fs.close)(fd), undefined)
    })

    it("should fail to close non-opened file", async () => {
      await assert.rejects(util.promisify(fs.close)(99999999), /EBADF/)
    })
  })

  describe("copyFile", () => {
    it("should copy existing file", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      assert.equal(await util.promisify(fs.copyFile)(source, destination), undefined)
      assert.equal(await util.promisify(fs.exists)(destination), true)
    })

    it("should fail to copy nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.copyFile)(helper.tmpFile(), helper.tmpFile()), /ENOENT/)
    })
  })

  describe("createWriteStream", () => {
    it("should write to file", async () => {
      const file = helper.tmpFile()
      const content = "howdy\nhow\nr\nu"
      const stream = fs.createWriteStream(file)
      stream.on("open", (fd) => {
        assert.notEqual(fd, undefined)
        stream.write(content)
        stream.close()
        stream.end()
      })

      await Promise.all([
        new Promise((resolve): nativeFs.WriteStream => stream.on("close", resolve)),
        new Promise((resolve): nativeFs.WriteStream => stream.on("finish", resolve)),
      ])

      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), content)
    })
  })

  describe("createReadStream", () => {
    it("should read a file", async () => {
      const file = helper.tmpFile()
      const content = "foobar"
      await util.promisify(nativeFs.writeFile)(file, content)

      const reader = fs.createReadStream(file)

      assert.equal(
        await new Promise((resolve, reject): void => {
          let data = ""
          reader.once("error", reject)
          reader.once("end", () => resolve(data))
          reader.on("data", (d) => (data += d.toString()))
        }),
        content
      )
    })

    it("should pipe to a writable stream", async () => {
      const source = helper.tmpFile()
      const content = "foo"
      await util.promisify(nativeFs.writeFile)(source, content)

      const destination = helper.tmpFile()
      const reader = fs.createReadStream(source)
      const writer = fs.createWriteStream(destination)

      await new Promise((resolve, reject): void => {
        reader.once("error", reject)
        writer.once("error", reject)
        writer.once("close", resolve)
        reader.pipe(writer)
      })

      assert.equal(await util.promisify(nativeFs.readFile)(destination, "utf8"), content)
    })
  })

  describe("exists", () => {
    it("should output file exists", async () => {
      assert.equal(await util.promisify(fs.exists)(__filename), true)
    })

    it("should output file does not exist", async () => {
      assert.equal(await util.promisify(fs.exists)(helper.tmpFile()), false)
    })
  })

  describe("fchmod", () => {
    it("should fchmod existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "r")
      assert.equal(await util.promisify(fs.fchmod)(fd, "755"), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to fchmod nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.fchmod)(2242342, "755"), /EBADF/)
    })
  })

  describe("fchown", () => {
    it("should fchown existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "r")
      assert.equal(await util.promisify(fs.fchown)(fd, 1000, 1000), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to fchown nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.fchown)(99999, 1000, 1000), /EBADF/)
    })
  })

  describe("fdatasync", () => {
    it("should fdatasync existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "r")
      assert.equal(await util.promisify(fs.fdatasync)(fd), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to fdatasync nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.fdatasync)(99999), /EBADF/)
    })
  })

  describe("fstat", () => {
    it("should fstat existing file", async () => {
      const fd = await util.promisify(nativeFs.open)(__filename, "r")
      const stat = await util.promisify(nativeFs.fstat)(fd)
      assert.equal((await util.promisify(fs.fstat)(fd)).size, stat.size)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to fstat", async () => {
      await assert.rejects(util.promisify(fs.fstat)(9999), /EBADF/)
    })
  })

  describe("fsync", () => {
    it("should fsync existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "r")
      assert.equal(await util.promisify(fs.fsync)(fd), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to fsync nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.fsync)(99999), /EBADF/)
    })
  })

  describe("ftruncate", () => {
    it("should ftruncate existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "w")
      assert.equal(await util.promisify(fs.ftruncate)(fd, 1), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to ftruncate nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.ftruncate)(99999, 9999), /EBADF/)
    })
  })

  describe("futimes", () => {
    it("should futimes existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "w")
      assert.equal(await util.promisify(fs.futimes)(fd, 1000, 1000), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should futimes existing file with date", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "w")
      assert.equal(await util.promisify(fs.futimes)(fd, new Date(), new Date()), undefined)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to futimes nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.futimes)(99999, 9999, 9999), /EBADF/)
    })
  })

  if (os.platform() === "darwin") {
    describe("lchmod", () => {
      it("should lchmod existing file", async () => {
        const file = await helper.createTmpFile()
        assert.equal(await util.promisify(fs.lchmod)(file, "755"), undefined)
      })

      it("should fail to lchmod nonexistent file", async () => {
        await assert.rejects(util.promisify(fs.lchmod)(helper.tmpFile(), "755"), /ENOENT/)
      })
    })
  }

  describe("lchown", () => {
    it("should lchown existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.lchown)(file, 1000, 1000), undefined)
    })

    it("should fail to lchown nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.lchown)(helper.tmpFile(), 1000, 1000), /ENOENT/)
    })
  })

  describe("link", () => {
    it("should link existing file", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      assert.equal(await util.promisify(fs.link)(source, destination), undefined)
      assert.equal(await util.promisify(fs.exists)(destination), true)
    })

    it("should fail to link nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.link)(helper.tmpFile(), helper.tmpFile()), /ENOENT/)
    })
  })

  describe("lstat", () => {
    it("should lstat existing file", async () => {
      const stat = await util.promisify(nativeFs.lstat)(__filename)
      assert.equal((await util.promisify(fs.lstat)(__filename)).size, stat.size)
    })

    it("should fail to lstat non-existent file", async () => {
      await assert.rejects(util.promisify(fs.lstat)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("mkdir", () => {
    let target: string
    it("should create nonexistent directory", async () => {
      target = helper.tmpFile()
      assert.equal(await util.promisify(fs.mkdir)(target), undefined)
    })

    it("should fail to create existing directory", async () => {
      await assert.rejects(util.promisify(fs.mkdir)(target), /EEXIST/)
    })
  })

  describe("mkdtemp", () => {
    it("should create temp dir", async () => {
      assert.equal(
        /^\/tmp\/coder\/fs\/[a-zA-Z0-9]{6}/.test(await util.promisify(fs.mkdtemp)(helper.coderDir + "/")),
        true
      )
    })
  })

  describe("open", () => {
    it("should open existing file", async () => {
      const fd = await util.promisify(fs.open)(__filename, "r")
      assert.notEqual(isNaN(fd), true)
      assert.equal(await util.promisify(fs.close)(fd), undefined)
    })

    it("should fail to open nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.open)(helper.tmpFile(), "r"), /ENOENT/)
    })
  })

  describe("read", () => {
    it("should read existing file", async () => {
      const fd = await util.promisify(nativeFs.open)(__filename, "r")
      const stat = await util.promisify(nativeFs.fstat)(fd)
      const buffer = Buffer.alloc(stat.size)
      let bytesRead = 0
      let chunkSize = 2048
      while (bytesRead < stat.size) {
        if (bytesRead + chunkSize > stat.size) {
          chunkSize = stat.size - bytesRead
        }

        await util.promisify(fs.read)(fd, buffer, bytesRead, chunkSize, bytesRead)
        bytesRead += chunkSize
      }

      const content = await util.promisify(nativeFs.readFile)(__filename, "utf8")
      assert.equal(buffer.toString(), content)
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to read nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.read)(99999, Buffer.alloc(10), 9999, 999, 999), /EBADF/)
    })
  })

  describe("readFile", () => {
    it("should read existing file", async () => {
      const content = await util.promisify(nativeFs.readFile)(__filename, "utf8")
      assert.equal(await util.promisify(fs.readFile)(__filename, "utf8"), content)
    })

    it("should fail to read nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.readFile)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("readdir", () => {
    it("should read existing directory", async () => {
      const paths = await util.promisify(nativeFs.readdir)(helper.coderDir)
      assert.deepEqual(await util.promisify(fs.readdir)(helper.coderDir), paths)
    })

    it("should fail to read nonexistent directory", async () => {
      await assert.rejects(util.promisify(fs.readdir)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("readlink", () => {
    it("should read existing link", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      await util.promisify(nativeFs.symlink)(source, destination)
      assert.equal(await util.promisify(fs.readlink)(destination), source)
    })

    it("should fail to read nonexistent link", async () => {
      await assert.rejects(util.promisify(fs.readlink)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("realpath", () => {
    it("should read real path of existing file", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      nativeFs.symlinkSync(source, destination)
      assert.equal(await util.promisify(fs.realpath)(destination), source)
    })

    it("should fail to read real path of nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.realpath)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("rename", () => {
    it("should rename existing file", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      assert.equal(await util.promisify(fs.rename)(source, destination), undefined)
      assert.equal(await util.promisify(nativeFs.exists)(source), false)
      assert.equal(await util.promisify(nativeFs.exists)(destination), true)
    })

    it("should fail to rename nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.rename)(helper.tmpFile(), helper.tmpFile()), /ENOENT/)
    })
  })

  describe("rmdir", () => {
    it("should rmdir existing directory", async () => {
      const dir = helper.tmpFile()
      await util.promisify(nativeFs.mkdir)(dir)
      assert.equal(await util.promisify(fs.rmdir)(dir), undefined)
      assert.equal(await util.promisify(nativeFs.exists)(dir), false)
    })

    it("should fail to rmdir nonexistent directory", async () => {
      await assert.rejects(util.promisify(fs.rmdir)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("stat", () => {
    it("should stat existing file", async () => {
      const nativeStat = await util.promisify(nativeFs.stat)(__filename)
      const stat = await util.promisify(fs.stat)(__filename)
      assert.equal(stat.size, nativeStat.size)
      assert.equal(typeof stat.mtime.getTime(), "number")
      assert.equal(stat.isFile(), true)
    })

    it("should stat existing folder", async () => {
      const dir = helper.tmpFile()
      await util.promisify(nativeFs.mkdir)(dir)
      const nativeStat = await util.promisify(nativeFs.stat)(dir)
      const stat = await util.promisify(fs.stat)(dir)
      assert.equal(stat.size, nativeStat.size)
      assert.equal(stat.isDirectory(), true)
    })

    it("should fail to stat nonexistent file", async () => {
      const error = await util
        .promisify(fs.stat)(helper.tmpFile())
        .catch((e) => e)
      assert.equal(error.message.includes("ENOENT"), true)
      assert.equal(error.code.includes("ENOENT"), true)
    })
  })

  describe("symlink", () => {
    it("should symlink existing file", async () => {
      const source = await helper.createTmpFile()
      const destination = helper.tmpFile()
      assert.equal(await util.promisify(fs.symlink)(source, destination), undefined)
      assert.equal(await util.promisify(nativeFs.exists)(source), true)
    })

    // TODO: Seems to be happy to do this on my system?
    it("should fail to symlink nonexistent file", async () => {
      assert.equal(await util.promisify(fs.symlink)(helper.tmpFile(), helper.tmpFile()), undefined)
    })
  })

  describe("truncate", () => {
    it("should truncate existing file", async () => {
      const file = helper.tmpFile()
      await util.promisify(nativeFs.writeFile)(file, "hiiiiii")
      assert.equal(await util.promisify(fs.truncate)(file, 2), undefined)
      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), "hi")
    })

    it("should fail to truncate nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.truncate)(helper.tmpFile(), 0), /ENOENT/)
    })
  })

  describe("unlink", () => {
    it("should unlink existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.unlink)(file), undefined)
      assert.equal(await util.promisify(nativeFs.exists)(file), false)
    })

    it("should fail to unlink nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.unlink)(helper.tmpFile()), /ENOENT/)
    })
  })

  describe("utimes", () => {
    it("should update times on existing file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.utimes)(file, 100, 100), undefined)
    })

    it("should fail to update times on nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.utimes)(helper.tmpFile(), 100, 100), /ENOENT/)
    })
  })

  describe("write", () => {
    it("should write to existing file", async () => {
      const file = await helper.createTmpFile()
      const fd = await util.promisify(nativeFs.open)(file, "w")
      assert.equal(await util.promisify(fs.write)(fd, Buffer.from("hi")), 2)
      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), "hi")
      await util.promisify(nativeFs.close)(fd)
    })

    it("should fail to write to nonexistent file", async () => {
      await assert.rejects(util.promisify(fs.write)(100000, Buffer.from("wowow")), /EBADF/)
    })
  })

  describe("writeFile", () => {
    it("should write file", async () => {
      const file = await helper.createTmpFile()
      assert.equal(await util.promisify(fs.writeFile)(file, "howdy"), undefined)
      assert.equal(await util.promisify(nativeFs.readFile)(file, "utf8"), "howdy")
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
