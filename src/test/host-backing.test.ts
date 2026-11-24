import assert from "node:assert/strict";
import { test } from "node:test";
import { HostBacking } from "../host/backing.js";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleImageRelease, thistleImageReserve } from "../native/kernel.js";
import { thistleProcessRecord } from "../native/process-state.js";
import { thistleVfsCreate } from "../native/vfs-edit.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";
import { thistleVfsResidentUsage } from "../native/vfs.js";

test("host byte carriers preserve copies and reject stale lazy completion", async () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  const input = thistleImageReserve(memory, 1);
  memory.bytes[input] = 102;
  const inode = thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 0n);
  assert.ok(inode > 1);
  assert.equal(thistleImageRelease(memory, input, 1), 0);
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const store = new HostBacking(memory), original = new Uint8Array([1, 2]);
  store.setBytes(inode, proc, original);
  original[0] = 99;
  const returned = await store.read(inode, proc);
  assert.deepEqual([...returned], [1, 2]);
  returned[0] = 88;
  assert.deepEqual([...await store.read(inode, proc)], [1, 2]);
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  store.setSource(inode, proc, { size: 2, sum: "", head: null, load: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(thistleVfsResidentUsage(memory), 256n);
  const pending = store.read(inode, proc);
  store.setBytes(inode, proc, new Uint8Array([7, 8]));
  finish(new Uint8Array([3, 4]));
  await assert.rejects(pending, { code: "EAGAIN" });
  assert.deepEqual([...await store.read(inode, proc)], [7, 8]);
  store.collect();
  assert.deepEqual([...await store.read(inode, proc)], [7, 8]);
});

