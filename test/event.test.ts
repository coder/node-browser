import * as assert from "assert"
import { Emitter } from "../src/common/events"
import { testFn } from "./helpers"

describe("Event", () => {
  const emitter = new Emitter<number>()

  it("should listen to global event", () => {
    const fn = testFn()
    const d = emitter.event(fn)
    emitter.emit(10)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [10])
    d.dispose()
  })

  it("should listen to id event", () => {
    const fn = testFn()
    const d = emitter.event(0, fn)
    emitter.emit(0, 5)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [5])
    d.dispose()
  })

  it("should listen to string id event", () => {
    const fn = testFn()
    const d = emitter.event("string", fn)
    emitter.emit("string", 55)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [55])
    d.dispose()
  })

  it("should not listen wrong id event", () => {
    const fn = testFn()
    const d = emitter.event(1, fn)
    emitter.emit(0, 5)
    emitter.emit(1, 6)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [6])
    d.dispose()
  })

  it("should listen to id event globally", () => {
    const fn = testFn()
    const d = emitter.event(fn)
    emitter.emit(1, 11)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [11])
    d.dispose()
  })

  it("should listen to global event", () => {
    const fn = testFn()
    const d = emitter.event(3, fn)
    emitter.emit(14)
    assert.equal(fn.called, 1)
    assert.deepEqual(fn.args, [14])
    d.dispose()
  })

  it("should listen to id event multiple times", () => {
    const fn = testFn()
    const disposers = [emitter.event(934, fn), emitter.event(934, fn), emitter.event(934, fn), emitter.event(934, fn)]
    emitter.emit(934, 324)
    assert.equal(fn.called, 4)
    assert.deepEqual(fn.args, [324, 324, 324, 324])
    disposers.forEach((d) => d.dispose())
  })

  it("should dispose individually", () => {
    const fn = testFn()
    const d = emitter.event(fn)

    const fn2 = testFn()
    const d2 = emitter.event(1, fn2)

    d.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(fn.called, 0)
    assert.equal(fn2.called, 2)

    d2.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(fn.called, 0)
    assert.equal(fn2.called, 2)
  })

  it("should dispose by id", () => {
    const fn = testFn()
    emitter.event(fn)

    const fn2 = testFn()
    emitter.event(1, fn2)

    emitter.dispose(1)

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(fn.called, 2)
    assert.equal(fn2.called, 0)
  })

  it("should dispose all", () => {
    const fn = testFn()
    emitter.event(fn)
    emitter.event(1, fn)

    emitter.dispose()

    emitter.emit(12)
    emitter.emit(1, 12)

    assert.equal(fn.called, 0)
  })
})
