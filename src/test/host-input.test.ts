import assert from "node:assert/strict";
import { test } from "node:test";
import { Kern } from "../core/kernel.js";
import { Sys } from "../core/sys.js";
import { FnApp } from "../apps/base.js";
import { enc, MemOut, Pipe } from "../io/stream.js";
import { Tty } from "../io/tty.js";

test("cancelling one pipe reader preserves queued data and other readers", async () => {
  const pipe = new Pipe(), cancelled = new AbortController();
  const first = pipe.rd(cancelled.signal), second = pipe.rd();
  const rejected = assert.rejects(first, { code: "EINTR" });
  cancelled.abort();
  await rejected;
  assert.equal(await pipe.wr(enc("next")), 4);
  assert.deepEqual(await second, enc("next"));
  await pipe.wr(enc("queued"));
  await assert.rejects(pipe.rd(cancelled.signal), { code: "EINTR" });
  assert.equal(pipe.readable, true);
  assert.deepEqual(await pipe.rd(), enc("queued"));
  const atEnd = pipe.rd();
  pipe.close();
  assert.deepEqual(await atEnd, new Uint8Array());
  assert.deepEqual(await pipe.rd(), new Uint8Array());
});

test("terminal cancellation preserves canonical EOF and the following input", async () => {
  const tty = new Tty(() => {}, () => false), cancelled = new AbortController();
  const first = tty.input.rd(cancelled.signal), rejected = assert.rejects(first, { code: "EINTR" });
  cancelled.abort();
  await rejected;
  tty.feed("\x04");
  tty.feed("next\n");
  assert.deepEqual(await tty.input.rd(), new Uint8Array());
  assert.deepEqual(await tty.input.rd(), enc("next\n"));
  tty.input.push(enc("discard"));
  tty.input.flush();
  tty.input.push(enc("retained"));
  assert.deepEqual(await tty.input.rd(), enc("retained"));
});

test("a killed callback cannot consume the next process's shared input", async () => {
  const kernel = new Kern(), input = new Pipe(), output = new MemOut();
  const parent = kernel.session({ sin: input, sout: output, serr: output }), sys = new Sys(kernel, parent);
  const latch = { entered: (): void => { throw new Error("entry latch not initialised"); } };
  let entered = new Promise<void>(resolve => { latch.entered = resolve; });
  sys.mkdir("/bin");
  kernel.install(new FnApp("reader", "input fixture", "reader", async childSys => {
    latch.entered();
    return (await childSys.chunkb()).length;
  }));
  const first = sys.start("reader", []);
  await entered;
  assert.equal(sys.kill(first.pid, 9), 1);
  assert.equal(await sys.wait(first.pid), 137);
  entered = new Promise<void>(resolve => { latch.entered = resolve; });
  const second = sys.start("reader", []);
  await entered;
  assert.equal(second.native.hart, first.native.hart);
  await input.wr(enc("next"));
  assert.equal(await sys.wait(second.pid), 4, output.text());
  await input.wr(enc("parent"));
  assert.deepEqual(await sys.chunkb(), enc("parent"));
});

test("a blocked signal cannot end a sleeping callback", async () => {
  const kernel = new Kern(), input = new Pipe(), output = new MemOut();
  const parent = kernel.session({ sin: input, sout: output, serr: output }), sys = new Sys(kernel, parent);
  const latch = { entered: (): void => { throw new Error("entry latch not initialised"); } };
  const entered = new Promise<void>(resolve => { latch.entered = resolve; });
  sys.mkdir("/bin");
  kernel.install(new FnApp("masked", "signal fixture", "masked", async childSys => {
    childSys.p.setSignalMask(0, 1n << 14n);
    childSys.p.state = "sleep";
    latch.entered();
    return (await childSys.chunkb()).length;
  }));
  const child = sys.start("masked", []);
  await entered;
  assert.equal(sys.kill(child.pid, 15), 1);
  assert.equal(child.completed, false);
  assert.equal(child.state, "sleep");
  assert.equal(child.ac.signal.aborted, false);
  await input.wr(enc("data"));
  assert.equal(await sys.wait(child.pid), 4, output.text());
});
