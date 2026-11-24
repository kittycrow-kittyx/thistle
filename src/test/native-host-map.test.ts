import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingKernel } from "./vfs-fixture.js";
import { thistleMapHostFile, thistleMapHostDescriptor, thistleUnmapHostFile, thistleRemapHostFile, thistleCloseDescriptor,
  thistleHartSetX, thistleMarkGuestWrite, thistleGuestPage, thistleGuestAccess, thistleProcessMapCount, thistleProcessRecord, thistleProcessMapAddress, thistleProcessMapEnd } from "../native/kernel.js";
import { withImage } from "../host/native-access.js";
import { H_LOCK, P_MAP_CAPACITY, P_MAP_TABLE, THISTLE_MAP_STRIDE, M_FILE_OFFSET, M_INODE, THISTLE_VFS_KIND_FILE, THISTLE_FD_READ, THISTLE_FD_WRITE, P_PAGE_TABLE, P_PAGE_CAPACITY, THISTLE_PAGE_ENTRY_SIZE, PAGE_DIRTY_FRAME } from "../native/abi.js";
import { hartAt } from "../native/state.js";
import { storeU32, loadU32, loadU64 } from "../native/memory.js";
import { thistleVfsKind, thistleVfsOpenInode } from "../native/vfs.js";
import { thistleVfsCreate, thistleVfsUnlink } from "../native/vfs-edit.js";
import { clearDirtyBytes, hasDirtyBytes } from "../native/arena.js";

test("host mappings reuse canonical resize policy and preserve moved bytes", () => {
  const memory = mappingKernel();
  const original = thistleMapHostFile(memory, 0, 0x400000n, 4096n, 3n, 0x100022n);
  assert.equal(original, 0x400000n);
  const page = thistleGuestPage(memory, 0, original, true);
  memory.bytes[page] = 42;
  const blocker = thistleMapHostFile(memory, 0, original + 4096n, 4096n, 3n, 0x100022n);
  assert.equal(blocker, original + 4096n);
  const resize = (address: bigint, oldSize: bigint, newSize: bigint, flags = 1n): bigint => {
    for (const [register, value] of [[10, address], [11, oldSize], [12, newSize], [13, flags], [14, 0n]] as const) {
      assert.equal(thistleHartSetX(memory, 0, register, value), 0);
    }
    return thistleRemapHostFile(memory, 0);
  };
  assert.equal(resize(original, 4096n, 8192n, 0n), -12n);
  assert.equal(memory.bytes[page], 42);
  const moved = resize(original, 4096n, 8192n);
  assert.ok(moved > 0n);
  assert.notEqual(moved, original);
  assert.equal(thistleGuestAccess(memory, 0, 1, original, 1, 1), -14);
  assert.equal(thistleGuestAccess(memory, 0, 1, moved + 4096n, 1, 2), 0);
  const movedPage = thistleGuestPage(memory, 0, moved, false);
  assert.equal(memory.view.getUint8(movedPage + Number(moved & 0xffffn)), 42);
  assert.equal(resize(moved, 8192n, 4096n), moved);
  assert.equal(thistleGuestAccess(memory, 0, 1, moved + 4096n, 1, 1), -14);
  storeU32(memory, hartAt(0) + H_LOCK, 1);
  assert.equal(thistleUnmapHostFile(memory, 0, moved, 4096n), -11n);
  storeU32(memory, hartAt(0) + H_LOCK, 0);
  assert.equal(thistleUnmapHostFile(memory, 0, moved, 4096n), 0n);
  assert.equal(thistleUnmapHostFile(memory, 0, blocker, 4096n), 0n);
  assert.equal(thistleProcessMapCount(memory, 0), 0);
});


test("partial unmaps preflight capacity and preserve surviving ranges and file offsets", () => {
  const memory = mappingKernel(), proc = thistleProcessRecord(memory, 0), address = 0x400000n;
  assert.equal(thistleMapHostFile(memory, 0, address, 24576n, 3n, 0x100022n), address);
  const page = thistleGuestPage(memory, 0, address, true);
  for (let index = 0; index < 6; index++) memory.bytes.fill(index + 1, page + index * 4096, page + (index + 1) * 4096);
  const capacity = loadU32(memory, proc + P_MAP_CAPACITY);
  storeU32(memory, proc + P_MAP_CAPACITY, 1);
  assert.equal(thistleUnmapHostFile(memory, 0, address + 4096n, 4096n), -12n);
  assert.equal(thistleProcessMapCount(memory, 0), 1);
  assert.equal(memory.view.getUint8(page + 4096), 2);
  assert.equal(thistleGuestAccess(memory, 0, 1, address + 4096n, 1, 1), 0);
  storeU32(memory, proc + P_MAP_CAPACITY, capacity);
  assert.equal(thistleUnmapHostFile(memory, 0, address + 4096n, 4096n), 0n);
  assert.equal(thistleProcessMapCount(memory, 0), 2);
  assert.equal(thistleProcessMapEnd(memory, 0, 0), address + 4096n);
  assert.equal(thistleProcessMapAddress(memory, 0, 1), address + 8192n);
  assert.equal(memory.view.getUint8(page + 4096), 0);
  assert.equal(memory.view.getUint8(page), 1);
  const right = loadU32(memory, proc + P_MAP_TABLE) + THISTLE_MAP_STRIDE;
  assert.equal(loadU64(memory, right + M_FILE_OFFSET), 8192n);
  assert.equal(thistleUnmapHostFile(memory, 0, address + 20480n, 4096n), 0n);
  assert.equal(thistleProcessMapEnd(memory, 0, 1), address + 20480n);
  assert.equal(thistleUnmapHostFile(memory, 0, address + 8192n, 4096n), 0n);
  assert.equal(thistleProcessMapAddress(memory, 0, 1), address + 12288n);
  assert.equal(loadU64(memory, right + M_FILE_OFFSET), 12288n);
  assert.equal(memory.view.getUint8(page + 12288), 4);
  assert.equal(thistleUnmapHostFile(memory, 0, address + 12288n, 8192n), 0n);
  assert.equal(thistleProcessMapCount(memory, 0), 1);
  assert.equal(thistleUnmapHostFile(memory, 0, address, 4096n), 0n);
  assert.equal(thistleProcessMapCount(memory, 0), 0);
});

test("canonical mapped inodes survive descriptor close, unlink and range splitting", () => {
  const memory = mappingKernel(), proc = thistleProcessRecord(memory, 0), address = 0x400000n;
  withImage(memory, 16, input => {
    memory.bytes.set(new TextEncoder().encode("file"), input);
    const inode = thistleVfsCreate(memory, proc, 1, input, 4, THISTLE_VFS_KIND_FILE, 0o644, 1n);
    assert.ok(inode > 1);
    const descriptor = thistleVfsOpenInode(memory, proc, inode, THISTLE_FD_READ, 3);
    assert.ok(descriptor >= 3);
    assert.equal(thistleMapHostDescriptor(memory, 0, address, 12288n, 3n, 0x100001n, descriptor, 4096n), -13n);
    assert.equal(thistleProcessMapCount(memory, 0), 0);
    assert.equal(thistleMapHostDescriptor(memory, 0, address, 12288n, 1n, 0x100002n, descriptor, 4096n), address);
    assert.equal(thistleCloseDescriptor(memory, 0, descriptor), 0);
    assert.equal(thistleVfsUnlink(memory, proc, 1, input, 4, false, 2n), 0);
    assert.equal(thistleVfsKind(memory, inode), THISTLE_VFS_KIND_FILE);
    assert.equal(thistleUnmapHostFile(memory, 0, address + 4096n, 4096n), 0n);
    const right = loadU32(memory, proc + P_MAP_TABLE) + THISTLE_MAP_STRIDE;
    assert.equal(loadU32(memory, right + M_INODE), inode);
    assert.equal(loadU64(memory, right + M_FILE_OFFSET), 12288n);
    assert.equal(thistleUnmapHostFile(memory, 0, address, 4096n), 0n);
    assert.equal(thistleVfsKind(memory, inode), THISTLE_VFS_KIND_FILE);
    assert.equal(thistleUnmapHostFile(memory, 0, address + 8192n, 4096n), 0n);
    assert.equal(thistleVfsKind(memory, inode), 0);
  });
});


test("shared mapping dirty bytes remain canonical and block destructive unmap", () => {
  const memory = mappingKernel(), proc = thistleProcessRecord(memory, 0), address = 0x400000n;
  withImage(memory, 16, input => {
    memory.bytes.set(new TextEncoder().encode("dirty"), input);
    const inode = thistleVfsCreate(memory, proc, 1, input, 5, THISTLE_VFS_KIND_FILE, 0o644, 1n);
    const fd = thistleVfsOpenInode(memory, proc, inode, THISTLE_FD_READ | THISTLE_FD_WRITE, 3);
    assert.equal(thistleMapHostDescriptor(memory, 0, address, 4096n, 3n, 0x100001n, fd, 0n), address);
    assert.equal(thistleMarkGuestWrite(memory, 0, address + 31n, 3), 0);
    const table = loadU32(memory, proc + P_PAGE_TABLE), capacity = loadU32(memory, proc + P_PAGE_CAPACITY);
    let entry = 0;
    for (let index = 0; index < capacity; index++) {
      const slot = table + index * THISTLE_PAGE_ENTRY_SIZE;
      if (loadU64(memory, slot) === (address >> 16n) + 1n) entry = slot;
    }
    assert.notEqual(entry, 0);
    assert.notEqual(loadU32(memory, entry + PAGE_DIRTY_FRAME), 0);
    assert.equal(hasDirtyBytes(memory, entry, 30, 1), false);
    assert.equal(hasDirtyBytes(memory, entry, 31, 3), true);
    assert.equal(hasDirtyBytes(memory, entry, 34, 1), false);
    assert.equal(thistleUnmapHostFile(memory, 0, address, 4096n), -16n);
    clearDirtyBytes(memory, entry, 32, 1);
    assert.equal(hasDirtyBytes(memory, entry, 32, 1), false);
    assert.equal(hasDirtyBytes(memory, entry, 31, 1), true);
    assert.equal(hasDirtyBytes(memory, entry, 33, 1), true);
    clearDirtyBytes(memory, entry, 31, 3);
    assert.equal(thistleUnmapHostFile(memory, 0, address, 4096n), 0n);
  });
});
