import assert from "node:assert/strict";
import { test } from "node:test";
import { Kern } from "../core/kernel.js";
import { Sys } from "../core/sys.js";
import { defaultKernelOptions } from "../core/host-options.js";
import { MemIn, MemOut } from "../io/stream.js";
import { Exe, codec } from "../../thistle-asm/fmt.js";
import { thistleProcessCount, thistleProcessIdentity } from "../native/kernel.js";
import { loadU32 } from "../native/memory.js";
import { C_PHYSICAL_NEXT } from "../native/abi.js";

const executable = (words: number[], data = new Uint8Array()): Uint8Array => {
  const code = new Uint8Array(words.length * 4), view = new DataView(code.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word, true));
  const exe = new Exe("thistle64");
  exe.isa = "rv64gc";
  exe.entry = 0x10000;
  exe.sec.push({ name: ".text", flg: "rx", align: 4096, addr: 0x10000, size: code.length, data: code });
  if (data.length !== 0) exe.sec.push({ name: ".rodata", flg: "r", align: 4096, addr: 0x20000, size: data.length, data });
  return codec.pack(exe);
};

test("hosted Kern executes RV64 through the canonical native core", async () => {
  const kernel = new Kern(defaultKernelOptions());
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
  const kernel = new Kern(defaultKernelOptions()), output = new MemOut();
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
  const kernel = new Kern(defaultKernelOptions()), output = new MemOut();
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
