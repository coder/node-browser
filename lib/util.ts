// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/* eslint-disable @typescript-eslint/no-explicit-any */

function inherits(ctor: any, superCtor: any) {
  if (ctor === undefined || ctor === null) {
    throw new Error("ctor");
  }
  if (superCtor === undefined || superCtor === null) {
    throw new Error("superCtor");
  }
  if (superCtor.prototype === undefined) {
    throw new Error("superCtor.prototype");
  }
  Object.defineProperty(ctor, "super_", {
    value: superCtor,
    writable: true,
    configurable: true
  });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

const kCustomPromisifiedSymbol = Symbol("util.promisify.custom")

function _promisify(original: any) {
  if (typeof original !== "function") {
    throw new TypeError("The 'original' argument must be of type Function")
  }

  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    const fn = original[kCustomPromisifiedSymbol]
    if (typeof fn !== "function") {
      throw new TypeError("The 'util.promisify.custom' argument must be of type Function")
    }
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn, enumerable: false, writable: false, configurable: true
    })
    return fn
  }

  function fn() {
    let promiseResolve: any
    let promiseReject: any
    const promise = new Promise(function (resolve, reject) {
      promiseResolve = resolve
      promiseReject = reject
    })

    const args = []
    for (let i = 0; i < arguments.length; i++) {
      args.push(arguments[i])
    }
    args.push(function (err: Error, value: any) {
      if (err) {
        promiseReject(err)
      } else {
        promiseResolve(value)
      }
    })

    try {
      // @ts-ignore
      original.apply(this, args)
    } catch (err) {
      promiseReject(err)
    }

    return promise
  }

  Object.setPrototypeOf(fn, Object.getPrototypeOf(original))

  Object.defineProperty(fn, kCustomPromisifiedSymbol, {
    value: fn, enumerable: false, writable: false, configurable: true
  })
  return Object.defineProperties(
    fn,
    Object.getOwnPropertyDescriptors(original)
  )
}

function callbackifyOnRejected(reason: Error, cb: (reason: Error) => void) {
  // `!reason` guard inspired by bluebird (Ref: https://goo.gl/t5IS6M).
  // Because `null` is a special error value in callbacks which means "no error
  // occurred", we error-wrap so the callback consumer can distinguish between
  // "the promise rejected with null" or "the promise fulfilled with undefined".
  if (!reason) {
    const newReason = new Error("Promise was rejected with a falsy value")
    ;(newReason as any).reason = reason
    reason = newReason
  }
  return cb(reason)
}

function _callbackify(original: any) {
  if (typeof original !== "function") {
    throw new TypeError("The 'original' argument must be of type Function")
  }

  // We DO NOT return the promise as it gives the user a false sense that
  // the promise is actually somehow related to the callback"s execution
  // and that the callback throwing will reject the promise.
  function callbackified() {
    const args = []
    for (let i = 0; i < arguments.length; i++) {
      args.push(arguments[i])
    }

    const maybeCb = args.pop()
    if (typeof maybeCb !== "function") {
      throw new TypeError("The last argument must be of type Function")
    }
    // @ts-ignore
    const self = this
    const cb = function() {
      return maybeCb.apply(self, arguments)
    }
    // In true node style we process the callback on `nextTick` with all the
    // implications (stack, `uncaughtException`, `async_hooks`)
    // @ts-ignore
    original.apply(this, args)
      .then(function(ret: any) { process.nextTick(cb.bind(null, null, ret)) },
            function(rej: any) { process.nextTick(callbackifyOnRejected.bind(null, rej, cb)) })
  }

  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original))
  Object.defineProperties(callbackified, Object.getOwnPropertyDescriptors(original))
  return callbackified
}

_promisify.custom = kCustomPromisifiedSymbol

const promisify: typeof import("util").promisify = _promisify as any
const callbackify: typeof import("util").callbackify = _callbackify as any
export { inherits, promisify, callbackify }
