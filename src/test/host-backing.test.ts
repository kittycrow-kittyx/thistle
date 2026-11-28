import assert from "node:assert/strict";
import { test } from "node:test";
import { HostProcess } from "../host/process.js";
import { HostBacking } from "../host/backing.js";
import { mountedKernel } from "./vfs-fixture.js";
import { withImage } from "../host/native-access.js";
import { thistleHartInit, thistleProcessInit, thistleProcessReap, thistleImageRelease, thistleImageReserve } from "../native/kernel.js";
import { thistleProcessRecord } from "../native/process-state.js";
import { thistleVfsCreate, thistleVfsUnlink } from "../native/vfs-edit.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";
import { thistleVfsResidentUsage } from "../native/vfs.js";

test("host byte carriers preserve copies and reject stale lazy completion", async () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0), process = new HostProcess(memory, 0);
  const input = thistleImageReserve(memory, 1);
  memory.bytes[input] = 102;
  const inode = thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 0n);
  assert.ok(inode > 1);
  assert.equal(thistleImageRelease(memory, input, 1), 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const store = new HostBacking(memory), original = new Uint8Array([1, 2]);
  store.setBytes(inode, process, original);
  original[0] = 99;
  const returned = await store.read(inode, process);
  assert.deepEqual([...returned], [1, 2]);
  returned[0] = 88;
  assert.deepEqual([...await store.read(inode, process)], [1, 2]);
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  store.setSource(inode, process, { size: 2, sum: "", head: null, load: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(thistleVfsResidentUsage(memory), 256n);
  const pending = store.read(inode, process);
  store.setBytes(inode, process, new Uint8Array([7, 8]));
  finish(new Uint8Array([3, 4]));
  await assert.rejects(pending, { code: "EAGAIN" });
  assert.deepEqual([...await store.read(inode, process)], [7, 8]);
  store.collect();
  assert.deepEqual([...await store.read(inode, process)], [7, 8]);
  store.setSource(inode, process, { size: 0, sum: "", head: null,
    load: () => { throw new Error("empty files must not fetch a provider"); } });
  assert.equal((await store.read(inode, process)).byteLength, 0);
});

test("lazy completion rejects a reaped reader even after its hart is reused", async () => {
  const memory = mountedKernel(2), root = new HostProcess(memory, 0);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 1000, 1000, 1000, 1000, 1000, 1000), 0);
  const child = new HostProcess(memory, 1);
  const input = thistleImageReserve(memory, 1);
  memory.bytes[input] = 102;
  const inode = root.withFilesystem(proc => thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 0n));
  assert.equal(thistleImageRelease(memory, input, 1), 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  const store = new HostBacking(memory);
  let loads = 0;
  store.setSource(inode, root, { size: 2, sum: "", head: null, load: () => {
    loads++;
    return loads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(new Uint8Array([3, 4]));
  } });
  const pending = store.read(inode, child);
  child.finish(0);
  assert.equal(thistleProcessReap(memory, 0, child.pid), 0);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 3, 1, 0, 0, 0, 0, 0, 0), 0);
  const replacement = new HostProcess(memory, 1);
  finish(new Uint8Array([3, 4]));
  await assert.rejects(pending, { code: "ESRCH" });
  assert.equal(thistleVfsResidentUsage(memory), 256n);
  assert.deepEqual([...await store.read(inode, replacement)], [3, 4]);
  assert.equal(thistleVfsResidentUsage(memory), 258n);
  assert.equal(loads, 2);
});

test("lazy completion rejects an unlinked and recycled inode slot", async () => {
  const memory = mountedKernel(), root = new HostProcess(memory, 0);
  const create = (): number => withImage(memory, 1, input => {
    memory.bytes[input] = 102;
    return root.withFilesystem(proc => thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 0n));
  });
  const inode = create(), store = new HostBacking(memory);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  store.setSource(inode, root, { size: 2, sum: "", head: null, load: () => new Promise(resolve => { finish = resolve; }) });
  const pending = store.read(inode, root);
  withImage(memory, 1, input => {
    memory.bytes[input] = 102;
    assert.equal(root.withFilesystem(proc => thistleVfsUnlink(memory, proc, 1, input, 1, false, 1n)), 0);
  });
  assert.equal(create(), inode);
  store.setBytes(inode, root, new Uint8Array([7, 8]));
  finish(new Uint8Array([3, 4]));
  await assert.rejects(pending, { code: "ENOENT" });
  assert.deepEqual([...await store.read(inode, root)], [7, 8]);
});

test("byte carriers are isolated between canonical memory instances", async () => {
  const create = (byte: number) => {
    const memory = mountedKernel(), process = new HostProcess(memory, 0);
    const inode = withImage(memory, 1, input => {
      memory.bytes[input] = 102;
      return process.withFilesystem(proc => thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 0n));
    });
    assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
    const backing = new HostBacking(memory);
    backing.setBytes(inode, process, Uint8Array.of(byte));
    return { inode, process, backing };
  };
  const first = create(3), second = create(5);
  assert.equal(first.inode, second.inode);
  assert.deepEqual([...await first.backing.read(first.inode, first.process)], [3]);
  assert.deepEqual([...await second.backing.read(second.inode, second.process)], [5]);
  assert.throws(() => new HostBacking(first.process.memory), { code: "EBUSY" });
});
