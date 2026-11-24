import assert from "node:assert/strict";
import { test } from "node:test";
import { HostDescriptor } from "../host/descriptor.js";
import { HostBacking } from "../host/backing.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel } from "./vfs-fixture.js";
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
  assert.deepEqual([...backing.readDescriptor(fd, 2)], [1, 2]);
  assert.equal(backing.writeDescriptor(fd, Uint8Array.of(9)), 1);
  append.seekFile(0, 0);
  assert.equal(backing.writeDescriptor(append, Uint8Array.of(4)), 1);
  assert.equal(append.offset, 4);
  fd.seekFile(0, 0);
  assert.deepEqual([...backing.readDescriptor(fd, 8)], [1, 2, 9, 4]);
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
  const pending = backing.materialiseDescriptor(fd);
  fd.close();
  const next = HostDescriptor.open(process, file, THISTLE_FD_READ);
  assert.equal(next.number, fd.number);
  finish(Uint8Array.of(7, 8));
  await assert.rejects(pending, { code: "EBADF" });
  assert.equal(next.offset, 0);
  assert.throws(() => backing.readDescriptor(next, 2), { code: "EAGAIN" });
  next.close();
});
