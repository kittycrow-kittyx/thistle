import assert from "node:assert/strict";
import { test } from "node:test";
import { HostDescriptor } from "../host/descriptor.js";
import { HostBacking } from "../host/backing.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel, mappingKernel } from "./vfs-fixture.js";
import { thistleMapHostDescriptor, thistleUnmapHostFile } from "../native/kernel.js";
import { thistleVfsKind } from "../native/vfs.js";
import { THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_FD_APPEND } from "../native/abi.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";

test("carrier descriptor writes share native append, quota and unlink lifetime", () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  assert.equal(thistleVfsSetQuota(memory, 512n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "carrier", 1, 0o600);
  const backing = new HostBacking(memory);
  backing.setBytes(file.ino, process, Uint8Array.of(1, 2, 3));
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ | THISTLE_FD_WRITE);
  const append = HostDescriptor.open(process, file, THISTLE_FD_WRITE | THISTLE_FD_APPEND);
  file.chmod(process, 0);
  root.unlink(process, "carrier");
  assert.deepEqual([...fd.readFile(2)], [1, 2]);
  assert.equal(fd.writeFile(Uint8Array.of(9)), 1);
  append.seekFile(0, 0);
  assert.equal(append.writeFile(Uint8Array.of(4)), 1);
  assert.equal(append.offset, 4);
  fd.seekFile(0, 0);
  assert.deepEqual([...fd.readFile(8)], [1, 2, 9, 4]);
  assert.throws(() => backing.readDescriptor(append, 1), { code: "EBADF" });
  fd.seekFile(1024, 0);
  assert.throws(() => backing.writeDescriptor(fd, Uint8Array.of(5)), { code: "ENOSPC" });
  assert.equal(fd.offset, 1024);
  fd.close(); append.close();
  backing.collect();
  assert.throws(() => file.metadata(), { code: "ENOENT" });
});

test("lazy descriptor completion rejects a closed and reused slot", async () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "lazy", 1, 0o600);
  const backing = new HostBacking(memory);
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("provider not requested"); };
  backing.setSource(file.ino, process, { size: 2, sum: "", head: null,
    load: () => new Promise(resolve => { finish = resolve; }) });
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ);
  const pending = fd.materialiseFile();
  fd.close();
  const next = HostDescriptor.open(process, file, THISTLE_FD_READ);
  assert.equal(next.number, fd.number);
  finish(Uint8Array.of(7, 8));
  await assert.rejects(pending, { code: "EBADF" });
  assert.equal(next.offset, 0);
  assert.throws(() => next.readFile(2), { code: "EAGAIN" });
  next.close();
});

test("a lazy descriptor materialises through the installed mount registry", async () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "provider", 1, 0o600);
  const backing = new HostBacking(memory);
  let loads = 0;
  backing.setSource(file.ino, process, { size: 2, sum: "", head: null,
    load: async () => { loads++; return Uint8Array.of(4, 5); } });
  assert.throws(() => new HostBacking(memory), { code: "EBUSY" });
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ);
  await fd.materialiseFile();
  assert.equal(fd.offset, 0);
  assert.deepEqual([...fd.readFile(2)], [4, 5]);
  assert.equal(loads, 1);
  fd.close();
});

test("open authority promotes arena files and atomically replaces content", () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  assert.equal(thistleVfsSetQuota(memory, 2048n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "arena", 1, 0o600);
  file.write(process, Uint8Array.of(1, 2, 3), 0, true);
  const backing = new HostBacking(memory);
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ | THISTLE_FD_WRITE);
  fd.offset = 1;
  assert.equal(fd.writeFile(Uint8Array.of(9)), 1);
  assert.deepEqual(backing.snapshot(file, process), Uint8Array.of(1, 9, 3));
  fd.replaceFile(Uint8Array.of(6, 7));
  assert.equal(fd.offset, 2);
  assert.throws(() => fd.replaceFile(new Uint8Array(2048)), { code: "ENOSPC" });
  assert.deepEqual(backing.snapshot(file, process), Uint8Array.of(6, 7));
  fd.seekFile(0, 0);
  assert.deepEqual(fd.readFile(8), Uint8Array.of(6, 7));
  fd.close();
});

test("replacement discards lazy bytes without loading the provider", () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "lazy", 1, 0o600);
  const backing = new HostBacking(memory);
  backing.setSource(file.ino, process, { size: 8, sum: "", head: null,
    load: () => { throw new Error("replacement must not load a discarded provider"); } });
  const fd = HostDescriptor.open(process, file, THISTLE_FD_WRITE);
  fd.replaceFile(Uint8Array.of(42));
  assert.deepEqual(backing.snapshot(file, process), Uint8Array.of(42));
  fd.close();
});

test("mapped byte transport uses retained authority and never extends truncated files", () => {
  const memory = mappingKernel(), process = new HostProcess(memory, 0), address = 0x400000n;
  assert.equal(thistleVfsSetQuota(memory, 16384n), 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "mapped", 1, 0o600);
  const backing = new HostBacking(memory);
  backing.setBytes(file.ino, process, Uint8Array.of(1, 2, 3));
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ | THISTLE_FD_WRITE);
  assert.equal(thistleMapHostDescriptor(memory, 0, address, 4096n, 3n, 0x100001n, fd.number, 0n), address);
  fd.close();
  root.unlink(process, "mapped");
  const replacement = root.create(process, "mapped", 1, 0o600);
  backing.setBytes(replacement.ino, process, Uint8Array.of(8));
  assert.deepEqual(backing.readMapping(process, 0, address, 4096), Uint8Array.of(1, 2, 3));
  backing.writeMapping(process, 0, address + 1n, Uint8Array.of(9, 7, 6));
  assert.deepEqual(backing.readMapping(process, 0, address, 4096), Uint8Array.of(1, 9, 7));
  assert.deepEqual(backing.snapshot(replacement, process), Uint8Array.of(8));
  assert.equal(thistleUnmapHostFile(memory, 0, address, 4096n), 0n);
  assert.throws(() => backing.readMapping(process, 0, address, 1), { code: "EINVAL" });
  assert.equal(thistleVfsKind(memory, file.ino), 0);
});
