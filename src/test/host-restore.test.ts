import assert from "node:assert/strict";
import { test } from "node:test";
import { HostBacking } from "../host/backing.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel } from "./vfs-fixture.js";
import { withImage } from "../host/native-access.js";
import { thistleHartInit, thistleProcessInit } from "../native/kernel.js";
import { thistleVfsCreate } from "../native/vfs-edit.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";

test("trusted payload restoration preserves image metadata and checks root authority", async () => {
  const memory = mountedKernel(2), root = new HostProcess(memory, 0), store = new HostBacking(memory);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const inode = withImage(memory, 1, input => {
    memory.bytes[input] = 102;
    return root.withFilesystem(proc => thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o4755, 77n));
  });
  const node = new HostInode(memory, inode), before = node.metadata();
  store.install(inode, root, new Uint8Array([1, 2]));
  assert.deepEqual(node.metadata(), { ...before, size: 2n });
  store.install(inode, root, { size: 3, sum: "", head: null, load: async () => new Uint8Array([3, 4, 5]) });
  assert.deepEqual(node.metadata(), { ...before, size: 3n });
  assert.deepEqual([...await store.read(inode, root)], [3, 4, 5]);
  assert.deepEqual(node.metadata(), { ...before, size: 3n });
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 1000, 1000, 1000, 1000, 1000, 1000), 0);
  const unprivileged = new HostProcess(memory, 1);
  assert.throws(() => store.install(inode, unprivileged, new Uint8Array([9])), { code: "EPERM" });
  assert.deepEqual(node.metadata(), { ...before, size: 3n });
  store.install(inode, root, { size: 0, sum: "", head: null, load: () => { throw new Error("empty restore fetched data"); } });
  assert.equal((await store.read(inode, root)).byteLength, 0);
  assert.deepEqual(node.metadata(), { ...before, size: 0n });
  store.setBytes(inode, root, new Uint8Array([6]));
  assert.equal(node.metadata().mode, 0o755);
});
