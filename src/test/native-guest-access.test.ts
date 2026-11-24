import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleGuestAccess, thistleImageBegin, thistleImageSegment, thistleImageFinish,
  thistleImageReserve, thistleImageRelease } from "../native/kernel.js";
import { H_LOCK } from "../native/abi.js";
import { hartAt } from "../native/state.js";
import { loadU32, storeU32 } from "../native/memory.js";

test("host access checks use canonical image permissions and bound process identity", () => {
  const memory = mountedKernel(), input = thistleImageReserve(memory, 4);
  storeU32(memory, input, 0x73);
  assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
  assert.equal(thistleImageSegment(memory, 0, 1, 1, 0x200000n, 4n, 5, input, 4), 0);
  assert.equal(thistleImageFinish(memory, 0, 4), 0);
  assert.equal(thistleImageRelease(memory, input, 4), 0);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 4, 1), 0);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 4, 4), 0);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 4, 2), -14);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x10000n, 1, 1), -14);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x10000000n, 0, 1), 0);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x10000001n, 0, 1), -14);
  assert.equal(thistleGuestAccess(memory, 0, 2, 0x200000n, 4, 1), -3);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 0.5, 1), -14);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 4, 0), -22);
  storeU32(memory, hartAt(0) + H_LOCK, 1);
  assert.equal(thistleGuestAccess(memory, 0, 1, 0x200000n, 4, 1), -11);
  assert.equal(loadU32(memory, hartAt(0) + H_LOCK), 1);
  storeU32(memory, hartAt(0) + H_LOCK, 0);
});
