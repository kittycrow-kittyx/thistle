import assert from "node:assert/strict";
import { test } from "node:test";
import { planHostThistleVfs } from "../native/vfs-image.js";
import type { TreeEnt } from "../fs/tree.js";
import { mountedKernel, rootVfsImage } from "./vfs-fixture.js";
import { withImage } from "../host/native-access.js";
import { thistleVfsCreate } from "../native/vfs-edit.js";
import { thistleLoadVfs, thistleVfsIdentity, thistleVfsKind } from "../native/vfs.js";
import { thistleKernelInit, thistleProcessRecord, thistleOpenPath, thistleCloseDescriptor } from "../native/kernel.js";
import { P_CWD_INODE, P_DESCRIPTOR_TABLE, THISTLE_DESCRIPTOR_STRIDE, FD_KIND, THISTLE_VFS_BUSY } from "../native/abi.js";
import { directMemory, loadU32, storeU32 } from "../native/memory.js";

test("remount preserves live inode and working-directory references on refusal", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0), image = rootVfsImage();
  withImage(memory, 256, input => {
    memory.bytes[input] = 102;
    const file = thistleVfsCreate(memory, proc, 1, input, 1, 1, 0o644, 1n);
    const identity = thistleVfsIdentity(memory, file);
    memory.bytes[input] = 100;
    const directory = thistleVfsCreate(memory, proc, 1, input, 1, 2, 0o755, 1n);
    assert.ok(directory > file);
    memory.bytes[input] = 102;
    const fd = thistleOpenPath(memory, 0, 1, input, 1, 0);
    assert.ok(fd >= 3);
    memory.bytes.set(image, input);
    assert.equal(thistleLoadVfs(memory, input, image.length), THISTLE_VFS_BUSY);
    assert.equal(thistleVfsIdentity(memory, file), identity);
    const descriptor = loadU32(memory, proc + P_DESCRIPTOR_TABLE) + fd * THISTLE_DESCRIPTOR_STRIDE;
    storeU32(memory, descriptor + FD_KIND, 1);
    assert.equal(thistleLoadVfs(memory, input, image.length), THISTLE_VFS_BUSY);
    storeU32(memory, descriptor + FD_KIND, 2);
    assert.equal(thistleCloseDescriptor(memory, 0, fd), 0);
    storeU32(memory, proc + P_CWD_INODE, directory);
    assert.equal(thistleLoadVfs(memory, input, image.length), THISTLE_VFS_BUSY);
    assert.equal(thistleVfsIdentity(memory, file), identity);
    storeU32(memory, proc + P_CWD_INODE, 1);
    assert.equal(thistleLoadVfs(memory, input, image.length), 0);
    assert.equal(thistleVfsKind(memory, file), 0);
  });
});

test("default VFS loads a root with the audited mikuOS inode count", () => {
  const root: TreeEnt = { p: "/", k: "d", id: 1, mode: 0o755, uid: 0, gid: 0,
    at: 0, mt: 0, ct: 0, data: null, sum: null, size: null, source: null, to: null };
  const entries: TreeEnt[] = [root];
  for (let index = 0; index < 4667; index++) {
    entries.push({ ...root, p: "/f" + index, k: "f", id: index + 13, data: new Uint8Array(), size: 0 });
  }
  const memory = directMemory(64 * 1024 * 1024);
  assert.equal(thistleKernelInit(memory, 1, false), 0);
  const { image } = planHostThistleVfs(entries);
  withImage(memory, image.length, input => {
    memory.bytes.set(image, input);
    assert.equal(thistleLoadVfs(memory, input, image.length), 0);
  });
  assert.equal(thistleVfsKind(memory, 4679), 1);
});
