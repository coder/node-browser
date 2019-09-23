import * as assert from "assert"
import { Emitter } from "../src/common/events"

describe("Event", () => {
  const emitter = new Emitter<number>()

  it("should listen to global event", () => {
    const called : any[]= [];
    const d = emitter.event((v) => called.push(v))
    emitter.emit(10)
    assert.equal(called.length, 1)
    assert.equal(called[0], 10)
    d.dispose()
  })

  it("should listen to id event", () => {
    const called : any[]= [];
    const d = emitter.event(0, (v) => called.push(v))
    emitter.emit(0, 5)
    assert.equal(called.length, 1)
    assert.equal(called[0], 5)
    d.dispose()
  })

  it("should listen to string id event", () => {
    const called : any[]= [];
    const d = emitter.event("string", (v) => called.push(v))
    emitter.emit("string", 55)
    assert.equal(called.length, 1)
    assert.equal(called[0], 55)
    d.dispose()
  })

  it("should not listen wrong id event", () => {
    const called : any[]= []
    const d = emitter.event(1, (v) => called.push(v))
    emitter.emit(0, 5)
    emitter.emit(1, 6)
    assert.equal(called.length, 1)
    assert.equal(called[0], 6)
    d.dispose()
  })

  it("should listen to id event globally", () => {
    const called : any[]= []
    const d = emitter.event((v) => called.push(v))
    emitter.emit(1, 11)
    assert.equal(called.length, 1)
    assert.equal(called[0], 11)
    d.dispose()
  })

  it("should listen to global event", () => {
    const called : any[]= []
    const d = emitter.event(3, (v) => called.push(v))
    emitter.emit(14)
    assert.equal(called.length, 1)
    assert.equal(called[0], 14)
    d.dispose()
  })

  it("should listen to id event multiple times", () => {
    const called : any[]= []
    const disposers = [
      emitter.event(934, (v) => called.push(v)),
      emitter.event(934, (v) => called.push(v)),
      emitter.event(934, (v) => called.push(v)),
      emitter.event(934, (v) => called.push(v)),
    ]
    emitter.emit(934, 324)
    assert.equal(called.length, 4)
    assert.equal(called[0], 324)
    assert.equal(called[1], 324)
    assert.equal(called[2], 324)
    assert.equal(called[3], 324)
    disposers.forEach((d) => d.dispose())
  })

  it("should dispose individually", () => {
    const called : any[]= []
    const d = emitter.event((v) => called.push(v))

    const called2: any[] = []
    const d2 = emitter.event(1, (v) => called2.push(v))

    d.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(called.length, 0)
    assert.equal(called2.length, 2)

    d2.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(called.length, 0)
    assert.equal(called2.length, 2)
  })

  it("should dispose by id", () => {
    const called : any[]= []
    emitter.event((v) => called.push(v))

    const called2: any[] = []
    emitter.event(1, (v) => called2.push(v))

    emitter.dispose(1)

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(called.length, 2)
    assert.equal(called2.length, 0)
  })

  it("should dispose all", () => {
    const called : any[]= []
    emitter.event((v) => called.push(v))
    emitter.event(1, (v) => called.push(v))

    emitter.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(called.length, 0)
  })
})
