import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel, rootVfsImage } from "./vfs-fixture.js";
import { withImage } from "../host/native-access.js";
import { thistleVfsCreate } from "../native/vfs-edit.js";
import { thistleLoadVfs, thistleVfsIdentity, thistleVfsKind } from "../native/vfs.js";
import { thistleProcessRecord, thistleOpenPath, thistleCloseDescriptor } from "../native/kernel.js";
import { P_CWD_INODE, P_DESCRIPTOR_TABLE, THISTLE_DESCRIPTOR_STRIDE, FD_KIND, THISTLE_VFS_BUSY } from "../native/abi.js";
import { loadU32, storeU32 } from "../native/memory.js";

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
