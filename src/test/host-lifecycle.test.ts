import assert from "node:assert/strict";
import { test } from "node:test";
import { Kern } from "../core/kernel.js";
import { Sys } from "../core/sys.js";
import { FnApp } from "../apps/base.js";
import { MemIn, MemOut } from "../io/stream.js";
import { thistleProcessSetHostState } from "../native/process-host.js";
import { THISTLE_PROCESS_RUNNING, THISTLE_PROCESS_WAITING } from "../native/abi.js";

test("host callback phases and ready snapshots read canonical process state", async () => {
  const kernel = new Kern(), output = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const sys = new Sys(kernel, parent);
  const latch = {
    enter: (): void => { throw new Error("entry latch not initialised"); },
    release: (): void => { throw new Error("release latch not initialised"); },
  };
  const entered = new Promise<void>(resolve => { latch.enter = resolve; });
  const gate = new Promise<void>(resolve => { latch.release = resolve; });
  sys.mkdir("/bin");
  kernel.install(new FnApp("phase", "phase fixture", "phase", async childSys => {
    assert.equal(childSys.p.state, "run");
    latch.enter();
    await gate;
    return 7;
  }));
  const child = sys.start("phase", []), memory = kernel.canonical.memory;
  assert.equal(child.state, "ready");
  assert.ok(parent.kids.has(child.pid));
  const ready = kernel.sched.ready;
  assert.ok(ready.includes(child.pid));
  ready.length = 0;
  assert.ok(kernel.sched.ready.includes(child.pid));
  await entered;
  assert.equal(child.state, "run");
  assert.ok(!kernel.sched.ready.includes(child.pid));
  assert.equal(thistleProcessSetHostState(memory, child.native.hart, child.pid, THISTLE_PROCESS_WAITING), 0);
  assert.equal(child.state, "sleep");
  assert.equal(thistleProcessSetHostState(memory, child.native.hart, child.pid, THISTLE_PROCESS_RUNNING), 0);
  assert.equal(child.state, "run");
  await kernel.sched.yield(child);
  assert.equal(child.state, "run");
  child.native.finish(7);
  assert.equal(child.code, 7);
  assert.equal(child.completed, false);
  sys.reap(child.pid);
  assert.equal(child.native.phase.state, "zombie");
  assert.ok(kernel.procs.has(child.pid));
  latch.release();
  assert.equal(await child.done, 7, output.text());
  assert.equal(child.state, "zombie");
  assert.equal(child.completed, true);
  child.end(99);
  assert.equal(child.code, 7);
  assert.equal(await sys.wait(child.pid), 7);
  assert.ok(!parent.kids.has(child.pid));
  assert.equal(child.code, 7);
  assert.throws(() => child.native.phase, { code: "ESRCH" });
  assert.equal(thistleProcessSetHostState(memory, child.native.hart, child.pid, THISTLE_PROCESS_RUNNING), -3);
});

test("child membership follows native allocation without a hosted registration", () => {
  const kernel = new Kern(), output = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const child = kernel.canonical.create(kernel.canonical.nextPid(), parent.pid, parent.cred);
  assert.ok(!kernel.procs.has(child.pid));
  assert.ok(parent.kids.has(child.pid));
  child.finish(0);
  kernel.canonical.reap(parent.native, child.pid);
  assert.ok(!parent.kids.has(child.pid));
});

test("unblocked canonical signals reach the host abort capability", () => {
  const kernel = new Kern(), output = new MemOut(), term = 1n << 14n;
  const process = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  assert.equal(process.setSignalMask(0, term), 0n);
  assert.equal(process.signal(15), false);
  assert.equal(process.ac.signal.aborted, false);
  assert.equal(process.sig, null);
  assert.equal(process.setSignalMask(1, term), term);
  assert.equal(process.ac.signal.aborted, true);
  assert.equal(process.sig, 15);
  process.end(143);
  kernel.canonical.reap(kernel.init().native, process.pid);
  assert.equal(process.sig, 15);
  assert.equal(process.code, 143);
});
