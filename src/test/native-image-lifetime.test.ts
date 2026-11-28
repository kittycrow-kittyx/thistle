import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel } from "./vfs-fixture.js";
import { P_PAGE_TABLE, P_PAGE_CAPACITY, THISTLE_PAGE_ENTRY_SIZE, THISTLE_THX_MEMORY, C_MEMORY_LOCK, C_PHYSICAL_NEXT, THISTLE_SEGMENT_READ, THISTLE_SEGMENT_EXECUTE, THISTLE_THX_BUSY } from "../native/abi.js";
import { loadU32, loadU64, loadU8, storeU32 } from "../native/memory.js";
import {
  thistleHartInit, thistleProcessInit, thistleProcessSetGroup, thistleGuestPage,
  thistleImageReserve, thistleImageRelease, thistleImageBegin, thistleImageSegment,
  thistleImageFinish, thistleStackPrepare, thistleMapHostFile, thistleUnmapHostFile,
  thistleProcessMapCount,
} from "../native/kernel.js";
import { thistleProcessRecord } from "../native/process-state.js";
import { readGroup } from "../native/credentials.js";
import type { ThistleMemory } from "../native/memory.js";

const occupiedPageEntry = (memory: ThistleMemory, proc: number): number => {
  const table = loadU32(memory, proc + P_PAGE_TABLE), capacity = loadU32(memory, proc + P_PAGE_CAPACITY);
  for (let index = 0; index < capacity; index++) {
    const entry = table + index * THISTLE_PAGE_ENTRY_SIZE;
    if (loadU64(memory, entry) !== 0n) return entry;
  }
  throw new Error("expected an allocated guest page");
};

test("repeated image loads recycle pages while retaining peer memory and groups", () => {
  const memory = mountedKernel(2);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 0, 0, 0, 0, 0, 0), 0);
  const peer = thistleGuestPage(memory, 1, 0x10000n, true);
  memory.bytes[peer] = 77;
  for (let index = 0; index < 40; index++) assert.equal(thistleProcessSetGroup(memory, 0, index, index + 100), 0);
  const initial = loadU32(memory, C_PHYSICAL_NEXT), proc = thistleProcessRecord(memory, 0);
  let previous = 0;
  for (let cycle = 0; cycle < 80; cycle++) {
    const input = thistleImageReserve(memory, 4);
    assert.notEqual(input, 0xffffffff);
    storeU32(memory, input, 0x73);
    if (cycle === 1) {
      storeU32(memory, C_MEMORY_LOCK, 1);
      assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), THISTLE_THX_BUSY);
      assert.equal(thistleGuestPage(memory, 0, 0x200000n, false), previous);
      storeU32(memory, C_MEMORY_LOCK, 0);
    }
    // A malformed page must not clear the table or free any other frame.
    if (cycle === 2) {
      const entry = occupiedPageEntry(memory, proc), saved = loadU32(memory, entry + 8);
      const before = loadU32(memory, C_PHYSICAL_NEXT);
      storeU32(memory, entry + 8, 0xffffffff);
      assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), THISTLE_THX_MEMORY);
      assert.equal(loadU32(memory, C_PHYSICAL_NEXT), before);
      assert.notEqual(loadU64(memory, entry), 0n);
      storeU32(memory, entry + 8, saved);
    }
    assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
    assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
    assert.equal(thistleImageSegment(memory, 0, 1, 1, 0x200000n, 4n,
      THISTLE_SEGMENT_READ | THISTLE_SEGMENT_EXECUTE, input, 4), 0);
    assert.equal(thistleImageFinish(memory, 0, 4), 0);
    assert.equal(thistleImageRelease(memory, input, 4), 0);
    const current = thistleGuestPage(memory, 0, 0x200000n, false);
    assert.equal(loadU8(memory, current + 100), 0);
    memory.bytes[current + 100] = 42;
    assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial + 65536);
    assert.equal(loadU8(memory, peer), 77);
    assert.equal(readGroup(memory, proc, 39), 139);
    previous = current;
  }
  assert.equal(thistleStackPrepare(memory, 0, 0x0fe00000n, 0x0ffffff0n), 0);
  const mapped = thistleMapHostFile(memory, 0, 0n, 4096n, 3n, 1n);
  assert.ok(mapped > 0n);
  assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), THISTLE_THX_BUSY);
  assert.equal(thistleProcessMapCount(memory, 0), 1);
  assert.equal(thistleUnmapHostFile(memory, 0, mapped, 4096n), 0n);
  assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
});
