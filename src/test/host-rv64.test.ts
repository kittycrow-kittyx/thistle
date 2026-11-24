import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostKernel } from "../core/host-kernel.js";
import type { Kern } from "../core/kernel.js";
import { emptyStart } from "../core/kernel.js";
import { Sys } from "../core/sys.js";
import { MemIn, MemOut, FnOut, Pipe, enc } from "../io/stream.js";
import { Exe, codec } from "../../thistle-asm/fmt.js";
import { thistleProcessCount, thistleProcessIdentity, thistleHartStatus } from "../native/kernel.js";
import { loadU32 } from "../native/memory.js";
import { C_PHYSICAL_NEXT, THISTLE_HART_WAITING } from "../native/abi.js";

const executable = (words: number[], data = new Uint8Array(), dataFlags = "r"): Uint8Array => {
  const code = new Uint8Array(words.length * 4), view = new DataView(code.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word, true));
  const exe = new Exe("thistle64");
  exe.isa = "rv64gc";
  exe.entry = 0x10000;
  exe.sec.push({ name: ".text", flg: "rx", align: 4096, addr: 0x10000, size: code.length, data: code });
  if (data.length !== 0) exe.sec.push({ name: ".rodata", flg: dataFlags, align: 4096, addr: 0x20000, size: data.length, data });
  return codec.pack(exe);
};

test("hosted Kern executes RV64 through the canonical native core", async () => {
  const kernel = createHostKernel();
  const output = new MemOut(), error = new MemOut();
  const process = kernel.session({ sin: new MemIn(), sout: output, serr: error });
  const sys = new Sys(kernel, process);
  const text = new TextEncoder().encode("canonical RV64 ready\n");
  const words = [0x00100513, 0x000205b7, (text.length << 20) | 0x613,
    0x04000893, 0x73, 0x00000513, 0x05d00893, 0x73];
  sys.mkfile("/canonical.thx", executable(words, text), 0o755);
  const child = sys.start("/canonical.thx", []);
  assert.equal(child.native.memory, kernel.canonical.memory);
  assert.notEqual(child.native.hart, 0);
  assert.equal(await child.done, 0, error.text());
  assert.equal(output.text(), "canonical RV64 ready\n");
  assert.equal(await sys.wait(child.pid), 0);
  assert.equal(thistleProcessCount(kernel.canonical.memory), 2);
});

test("host and guest credentials share one process record across repeated execution", async () => {
  const kernel = createHostKernel(), output = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const sys = new Sys(kernel, parent), memory = kernel.canonical.memory;
  const initial = loadU32(memory, C_PHYSICAL_NEXT);
  sys.mkfile("/identity.thx", executable([
    0x3e800513, 0x09200893, 0x73, 0x0ae00893, 0x73, 0x05d00893, 0x73,
  ]), 0o755);
  for (let cycle = 0; cycle < 24; cycle++) {
    const child = sys.start("/identity.thx", []);
    assert.equal(child.native.memory, memory);
    assert.equal(await child.done, 232, output.text());
    assert.equal(child.cred.ruid, 1000);
    assert.equal(child.cred.euid, 1000);
    assert.equal(parent.cred.euid, 0);
    assert.equal(thistleProcessCount(memory), 3);
    assert.equal(await sys.wait(child.pid), 232);
    assert.equal(thistleProcessCount(memory), 2);
    assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
    assert.throws(() => child.native.identity(), { code: "ESRCH" });
  }
});

test("hosted identity operations reuse native permission policy", () => {
  const kernel = createHostKernel(), output = new MemOut();
  const process = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const sys = new Sys(kernel, process), memory = kernel.canonical.memory;
  assert.equal(thistleProcessIdentity(memory, process.native.hart, 0, 1000, 1000, 0), 0n);
  assert.equal(sys.euid, 1000);
  assert.throws(() => sys.setUid(2000), { code: "EPERM" });
  assert.throws(() => sys.setGroups([0.5]), { code: "EPERM" });
  sys.setUid(0);
  sys.setGroups([42, 43]);
  assert.deepEqual(process.native.identity().credentials.groups, [42, 43]);
  assert.throws(() => sys.setResuid(0xffffffff), { code: "EPERM" });
  assert.throws(() => sys.setGroups([0.5]), { code: "EINVAL" });
  sys.umask = 0o077;
  assert.equal(process.native.identity().umask, 0o077);
  const snapshot = process.cred;
  snapshot.euid = 999;
  snapshot.groups.push(999);
  assert.equal(sys.euid, 0);
  assert.deepEqual(sys.groups, [42, 43]);
});

test("concurrent guests retain independent pages in one kernel instance", async () => {
  const kernel = createHostKernel(), errors = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: errors, serr: errors });
  const sys = new Sys(kernel, parent), firstOutput = new MemOut(), secondOutput = new MemOut();
  const words = [0x00100513, 0x000205b7, 0x00100613, 0x04000893, 0x73,
    0x00000513, 0x05d00893, 0x73];
  sys.mkfile("/first.thx", executable(words, Uint8Array.of(65)), 0o755);
  sys.mkfile("/second.thx", executable(words, Uint8Array.of(66)), 0o755);
  const first = sys.start("/first.thx", [], { ...emptyStart(), io: { sin: null, sout: firstOutput, serr: errors } });
  const second = sys.start("/second.thx", [], { ...emptyStart(), io: { sin: null, sout: secondOutput, serr: errors } });
  assert.equal(first.native.memory, second.native.memory);
  assert.notEqual(first.native.hart, second.native.hart);
  assert.deepEqual(await Promise.all([first.done, second.done]), [0, 0], errors.text());
  assert.equal(firstOutput.text(), "A");
  assert.equal(secondOutput.text(), "B");
  assert.equal(await sys.wait(first.pid), 0);
  assert.equal(await sys.wait(second.pid), 0);
  assert.equal(thistleProcessCount(kernel.canonical.memory), 2);
});

test("exec replaces an image in the existing canonical process", async () => {
  const kernel = createHostKernel(), output = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const sys = new Sys(kernel, parent), memory = kernel.canonical.memory;
  const initial = loadU32(memory, C_PHYSICAL_NEXT);
  sys.mkfile("/replacement.thx", executable([0x00700513, 0x05d00893, 0x73]), 0o755);
  sys.mkfile("/exec.thx", executable([
    0x00020537, 0x00000593, 0x00000613, 0x0dd00893, 0x73,
    0x06300513, 0x05d00893, 0x73,
  ], new TextEncoder().encode("/replacement.thx\0")), 0o755);
  const child = sys.start("/exec.thx", []), pid = child.pid;
  assert.equal(await child.done, 7, output.text());
  assert.equal(child.pid, pid);
  assert.equal(child.cmd, "/replacement.thx");
  assert.equal(thistleProcessCount(memory), 3);
  assert.equal(await sys.wait(pid), 7);
  assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
});

test("delayed I/O from a killed guest cannot resume a reused hart", async () => {
  const kernel = createHostKernel(), errors = new MemOut();
  const parent = kernel.session({ sin: new MemIn(), sout: errors, serr: errors });
  const sys = new Sys(kernel, parent), memory = kernel.canonical.memory;
  const latch = {
    firstEntered: (): void => { throw new Error("first entry not initialised"); },
    secondEntered: (): void => { throw new Error("second entry not initialised"); },
    releaseFirst: (): void => { throw new Error("first release not initialised"); },
    releaseSecond: (): void => { throw new Error("second release not initialised"); },
  };
  const firstEntered = new Promise<void>(resolve => { latch.firstEntered = resolve; });
  const secondEntered = new Promise<void>(resolve => { latch.secondEntered = resolve; });
  const firstGate = new Promise<void>(resolve => { latch.releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { latch.releaseSecond = resolve; });
  const firstOut = new FnOut(async () => { latch.firstEntered(); await firstGate; });
  const secondOut = new FnOut(async () => { latch.secondEntered(); await secondGate; });
  sys.mkfile("/blocked.thx", executable([
    0x00100513, 0x000205b7, 0x00100613, 0x04000893, 0x73,
    0x00700513, 0x05d00893, 0x73,
  ], Uint8Array.of(65)), 0o755);
  const first = sys.start("/blocked.thx", [], { ...emptyStart(), io: { sin: null, sout: firstOut, serr: errors } });
  await firstEntered;
  assert.equal(sys.kill(first.pid, 9), 1);
  assert.equal(await sys.wait(first.pid), 137);
  const second = sys.start("/blocked.thx", [], { ...emptyStart(), io: { sin: null, sout: secondOut, serr: errors } });
  await secondEntered;
  assert.equal(second.native.hart, first.native.hart);
  latch.releaseFirst();
  // Drain settled I/O continuations before checking the reused hart.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(thistleHartStatus(memory, second.native.hart), THISTLE_HART_WAITING);
  latch.releaseSecond();
  assert.equal(await second.done, 7, errors.text());
  assert.equal(await sys.wait(second.pid), 7);
  assert.equal(thistleProcessCount(memory), 2);
});


test("killing a blocked RV64 reader preserves inherited input", async () => {
  const kernel = createHostKernel(), input = new Pipe(), errors = new MemOut();
  const parent = kernel.session({ sin: input, sout: errors, serr: errors }), sys = new Sys(kernel, parent);
  const memory = kernel.canonical.memory;
  sys.mkfile("/read.thx", executable([
    0x00000513, 0x000205b7, 0x00100613, 0x03f00893, 0x73,
    0x0005c503, 0x05d00893, 0x73,
  ], Uint8Array.of(0), "rw"), 0o755);
  const first = sys.start("/read.thx", []);
  // Materialisation and host read dispatch settle before this event-loop turn.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(thistleHartStatus(memory, first.native.hart), THISTLE_HART_WAITING);
  assert.equal(sys.kill(first.pid, 9), 1);
  assert.equal(await sys.wait(first.pid), 137);
  const second = sys.start("/read.thx", []);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(second.native.hart, first.native.hart);
  assert.equal(thistleHartStatus(memory, second.native.hart), THISTLE_HART_WAITING);
  await input.wr(enc("B"));
  assert.equal(await sys.wait(second.pid), 66, errors.text());
  await input.wr(enc("parent"));
  assert.deepEqual(await sys.chunkb(), enc("parent"));
});
