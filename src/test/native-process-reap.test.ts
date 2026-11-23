import assert from "node:assert/strict";
import { test } from "node:test";
import { directMemory, loadU8, loadU32, storeU32 } from "../native/memory.js";
import { C_PHYSICAL_FREE, C_PHYSICAL_NEXT, H_LOCK, THISTLE_HART_BASE, THISTLE_HART_STRIDE } from "../native/abi.js";
import {
  thistleExitHart, thistleGuestPage, thistleHartInit, thistleKernelInitWithVfs,
  thistleProcessCount, thistleProcessInit, thistleProcessReap,
} from "../native/kernel.js";

test("canonical process reaping retains live frames and zeroes recycled storage", () => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleKernelInitWithVfs(memory, 3, false, 16, 32, 4096), 0);
  const initial = loadU32(memory, C_PHYSICAL_NEXT);
  for (const [hart, pid] of [[0, 1], [1, 2], [2, 3]] as const) {
    assert.equal(thistleHartInit(memory, hart, 0x10000000n, 0n), 0);
    assert.equal(thistleProcessInit(memory, hart, pid, hart === 0 ? 0 : 1, 0, 0, 0, 0, 0, 0), 0);
  }
  const first = thistleGuestPage(memory, 1, 0x10000n, true);
  const live = thistleGuestPage(memory, 2, 0x10000n, true);
  memory.bytes[first] = 42; memory.bytes[live] = 77;
  assert.equal(thistleProcessReap(memory, 0, 2), -11);
  assert.equal(thistleExitHart(memory, 1, 7), 0);
  storeU32(memory, THISTLE_HART_BASE + THISTLE_HART_STRIDE + H_LOCK, 1);
  assert.equal(thistleProcessReap(memory, 0, 2), -11);
  assert.equal(thistleProcessCount(memory), 3);
  storeU32(memory, THISTLE_HART_BASE + THISTLE_HART_STRIDE + H_LOCK, 0);
  assert.equal(thistleProcessReap(memory, 0, 2), 0);
  assert.equal(thistleProcessCount(memory), 2);
  assert.equal(loadU32(memory, C_PHYSICAL_FREE), first);
  assert.equal(loadU8(memory, live), 77);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 4, 1, 0, 0, 0, 0, 0, 0), 0);
  assert.equal(thistleGuestPage(memory, 1, 0x10000n, true), first);
  assert.equal(loadU8(memory, first), 0);
  assert.equal(loadU8(memory, live), 77);
  assert.equal(thistleExitHart(memory, 1, 0), 0);
  assert.equal(thistleProcessReap(memory, 0, 4), 0);
  assert.equal(thistleExitHart(memory, 2, 0), 0);
  assert.equal(thistleProcessReap(memory, 0, 3), 0);
  assert.equal(thistleProcessCount(memory), 1);
  assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
  assert.equal(loadU32(memory, C_PHYSICAL_FREE), 0);
  assert.equal(thistleProcessReap(memory, 0, 1), -1);
  assert.equal(thistleProcessReap(memory, 0, 9999), -3);
});

test("repeated guest processes reuse the one canonical table and memory arena", () => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleKernelInitWithVfs(memory, 2, false, 16, 32, 4096), 0);
  assert.equal(thistleHartInit(memory, 0, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  const initial = loadU32(memory, C_PHYSICAL_NEXT);
  for (let pid = 2; pid < 82; pid++) {
    assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
    assert.equal(thistleProcessInit(memory, 1, pid, 1, 0, 0, 0, 0, 0, 0), 0);
    const page = thistleGuestPage(memory, 1, 0x10000n, true);
    assert.equal(page, initial);
    assert.equal(loadU8(memory, page), 0);
    memory.bytes[page] = 255;
    assert.equal(thistleExitHart(memory, 1, 0), 0);
    assert.equal(thistleProcessReap(memory, 0, pid), 0);
    assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
    assert.equal(thistleProcessCount(memory), 1);
  }
});
