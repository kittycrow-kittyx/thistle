import assert from "node:assert/strict";
import { test } from "node:test";
import { directMemory, loadU32, storeU32 } from "../native/memory.js";
import { thistleCloseDescriptor, thistleHartInit, thistleImageRelease, thistleImageReserve, thistleKernelInitWithVfs, thistleOpenPath, thistleProcessInit, thistleReadDescriptor } from "../native/kernel.js";
import { C_PROCESS_TABLE_BASE, C_VFS_DIRTY, C_VFS_GENERATION, P_FSUID, P_FSGID, THISTLE_VFS_KIND_DIRECTORY, THISTLE_VFS_KIND_FILE } from "../native/abi.js";
import { thistleLoadVfs, thistleVfsFileSize, thistleVfsKind, thistleVfsLookup, thistleVfsNlink, thistleVfsReadData } from "../native/vfs.js";
import { thistleVfsCreate, thistleVfsWrite, thistleVfsLink, thistleVfsUnlink, thistleVfsCanMove, thistleVfsRename, thistleVfsChmod, thistleVfsChown, thistleVfsUtime } from "../native/vfs-edit.js";

const setup = (): ReturnType<typeof directMemory> => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleKernelInitWithVfs(memory, 1, false, 16, 32, 4096), 0);
  const bytes = new Uint8Array(88), view = new DataView(bytes.buffer);
  for (const [at, value] of [[0, 0x31534656], [4, 1], [8, 1], [16, 1], [20, 88], [32, 1], [36, 2], [40, 0o755], [52, 1]] as const) view.setUint32(at, value, true);
  let hash = 0x811c9dc5;
  for (const byte of bytes.subarray(32)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  view.setUint32(24, hash, true);
  const image = thistleImageReserve(memory, bytes.length);
  memory.bytes.set(bytes, image);
  assert.equal(thistleLoadVfs(memory, image, bytes.length), 0);
  assert.equal(thistleImageRelease(memory, image, bytes.length), 0);
  assert.equal(thistleHartInit(memory, 0, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  return memory;
};

test("canonical VFS mutations preserve hard links, atomic failure and permissions", () => {
  const memory = setup(), proc = loadU32(memory, C_PROCESS_TABLE_BASE);
  const input = thistleImageReserve(memory, 8192);
  const name = (text: string): number => {
    const bytes = new TextEncoder().encode(text); memory.bytes.set(bytes, input); return bytes.length;
  };
  const file = thistleVfsCreate(memory, proc, 1, input, name("first"), THISTLE_VFS_KIND_FILE, 0o644, 1n);
  assert.ok(file > 1);
  memory.bytes.set([65, 66, 67], input + 256);
  assert.equal(thistleVfsWrite(memory, proc, file, input + 256, 3, 0, true, 2n), 3);
  assert.equal(thistleVfsLink(memory, proc, 1, file, input, name("second"), 3n), file);
  assert.equal(thistleVfsNlink(memory, file), 2);
  assert.equal(thistleVfsUnlink(memory, proc, 1, input, name("second"), false, 4n), 0);
  assert.equal(thistleVfsLookup(memory, 1, input, name("first")), file);
  assert.equal(thistleVfsLookup(memory, 1, input, name("second")), 0);
  assert.equal(thistleVfsNlink(memory, file), 1);
  assert.equal(thistleVfsWrite(memory, proc, file, input + 512, 5000, 0, true, 5n), -28);
  assert.equal(thistleVfsFileSize(memory, file), 3n);
  assert.equal(thistleVfsReadData(memory, file, 0n, input + 256, 3), 3);
  assert.deepEqual([...memory.bytes.slice(input + 256, input + 259)], [65, 66, 67]);
  storeU32(memory, proc + P_FSUID, 1000); storeU32(memory, proc + P_FSGID, 1000);
  assert.equal(thistleVfsWrite(memory, proc, file, input + 256, 1, 0, true, 6n), -13);
  assert.equal(thistleVfsChmod(memory, proc, file, 0o777, 6n), -1);
  assert.equal(thistleVfsChown(memory, proc, file, 1000, 1000, 6n), -1);
  assert.equal(thistleVfsUtime(memory, proc, file, 6n, 6n, 6n), -1);
  assert.equal(thistleVfsCreate(memory, proc, 1, input, name("denied"), THISTLE_VFS_KIND_FILE, 0o644, 6n), -13);
  storeU32(memory, proc + P_FSUID, 0); storeU32(memory, proc + P_FSGID, 0);
  const dir = thistleVfsCreate(memory, proc, 1, input, name("dir"), THISTLE_VFS_KIND_DIRECTORY, 0o755, 7n);
  assert.ok(dir > file);
  assert.equal(thistleVfsLink(memory, proc, 1, dir, input, name("bad-dir-link"), 7n), -1);
  assert.equal(thistleVfsCanMove(memory, dir, dir), false);
  assert.equal(thistleVfsCreate(memory, proc, dir, input, name("child"), THISTLE_VFS_KIND_FILE, 0o644, 8n) > 0, true);
  assert.equal(thistleVfsUnlink(memory, proc, 1, input, name("dir"), true, 9n), -39);
  assert.equal(loadU32(memory, C_VFS_DIRTY), 1);
  assert.ok(memory.view.getBigUint64(C_VFS_GENERATION, true) > 1n);
  assert.equal(thistleImageRelease(memory, input, 8192), 0);
});

test("a file can grow in place up to the available arena budget", () => {
  const memory = setup(), proc = loadU32(memory, C_PROCESS_TABLE_BASE);
  const input = thistleImageReserve(memory, 8192);
  memory.bytes.set(new TextEncoder().encode("file"), input);
  const inode = thistleVfsCreate(memory, proc, 1, input, 4, THISTLE_VFS_KIND_FILE, 0o644, 1n);
  memory.bytes.fill(42, input + 16, input + 16 + 4090);
  assert.equal(thistleVfsWrite(memory, proc, inode, input + 16, 3, 0, true, 1n), 3);
  assert.equal(thistleVfsWrite(memory, proc, inode, input + 16, 4090, 0, true, 2n), 4090);
  assert.equal(thistleVfsFileSize(memory, inode), 4090n);
  assert.equal(thistleVfsReadData(memory, inode, 0n, input + 16, 4090), 4090);
  assert.ok(memory.bytes.subarray(input + 16, input + 16 + 4090).every(byte => byte === 42));
  assert.equal(thistleImageRelease(memory, input, 8192), 0);
});

test("unlink retains open data and releases the inode after the final descriptor", () => {
  const memory = setup(), proc = loadU32(memory, C_PROCESS_TABLE_BASE);
  const input = thistleImageReserve(memory, 512);
  memory.bytes.set(new TextEncoder().encode("file"), input);
  const inode = thistleVfsCreate(memory, proc, 1, input, 4, THISTLE_VFS_KIND_FILE, 0o644, 1n);
  memory.bytes.set([1, 2, 3], input + 256);
  assert.equal(thistleVfsWrite(memory, proc, inode, input + 256, 3, 0, true, 1n), 3);
  const descriptor = thistleOpenPath(memory, 0, 1, input, 4, 0);
  assert.ok(descriptor >= 3);
  assert.equal(thistleVfsUnlink(memory, proc, 1, input, 4, false, 2n), 0);
  assert.equal(thistleVfsNlink(memory, inode), 0);
  assert.equal(thistleReadDescriptor(memory, 0, descriptor, input + 256, 3), 3);
  assert.deepEqual([...memory.bytes.slice(input + 256, input + 259)], [1, 2, 3]);
  assert.equal(thistleCloseDescriptor(memory, 0, descriptor), 0);
  assert.equal(thistleVfsKind(memory, inode), 0);
  // Repeated create/write/unlink must reuse inode slots and arena gaps.
  for (let index = 0; index < 80; index++) {
    const next = thistleVfsCreate(memory, proc, 1, input, 4, THISTLE_VFS_KIND_FILE, 0o644, 3n);
    assert.equal(next, inode);
    assert.equal(thistleVfsWrite(memory, proc, next, input + 256, 256, 0, true, 3n), 256);
    assert.equal(thistleVfsUnlink(memory, proc, 1, input, 4, false, 4n), 0);
  }
  assert.equal(thistleImageRelease(memory, input, 512), 0);
});

test("rename preserves inode identity and rejects directory cycles without mutation", () => {
  const memory = setup(), proc = loadU32(memory, C_PROCESS_TABLE_BASE);
  const input = thistleImageReserve(memory, 512);
  memory.bytes.set(new TextEncoder().encode("one"), input);
  memory.bytes.set(new TextEncoder().encode("two"), input + 16);
  const first = thistleVfsCreate(memory, proc, 1, input, 3, THISTLE_VFS_KIND_FILE, 0o644, 1n);
  const second = thistleVfsCreate(memory, proc, 1, input + 16, 3, THISTLE_VFS_KIND_FILE, 0o644, 1n);
  assert.equal(thistleVfsRename(memory, proc, 1, input, 3, 1, input + 16, 3, 2n), 0);
  assert.equal(thistleVfsLookup(memory, 1, input, 3), 0);
  assert.equal(thistleVfsLookup(memory, 1, input + 16, 3), first);
  assert.equal(thistleVfsKind(memory, second), 0);
  const parent = thistleVfsCreate(memory, proc, 1, input, 3, THISTLE_VFS_KIND_DIRECTORY, 0o755, 3n);
  const child = thistleVfsCreate(memory, proc, parent, input + 16, 3, THISTLE_VFS_KIND_DIRECTORY, 0o755, 3n);
  assert.equal(thistleVfsRename(memory, proc, 1, input, 3, child, input + 16, 3, 4n), -22);
  assert.equal(thistleVfsLookup(memory, 1, input, 3), parent);
  assert.equal(thistleImageRelease(memory, input, 512), 0);
});
