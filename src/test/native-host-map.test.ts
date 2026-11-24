import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleImageBegin, thistleImageSegment, thistleImageFinish, thistleStackPrepare,
  thistleMapHostFile, thistleUnmapHostFile, thistleRemapHostFile,
  thistleHartSetX, thistleGuestPage, thistleGuestAccess, thistleProcessMapCount } from "../native/kernel.js";
import { withImage } from "../host/native-access.js";
import { H_LOCK } from "../native/abi.js";
import { hartAt } from "../native/state.js";
import { storeU32 } from "../native/memory.js";

test("host mappings reuse canonical resize policy and preserve moved bytes", () => {
  const memory = mountedKernel();
  withImage(memory, 4, input => {
    storeU32(memory, input, 0x73);
    assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
    assert.equal(thistleImageSegment(memory, 0, 1, 1, 0x200000n, 4n, 5, input, 4), 0);
    assert.equal(thistleImageFinish(memory, 0, 4), 0);
  });
  assert.equal(thistleStackPrepare(memory, 0, 0xf000000n, 0xfffff00n), 0);
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
  assert.equal(memory.bytes[movedPage + Number(moved & 0xffffn)], 42);
  assert.equal(resize(moved, 8192n, 4096n), moved);
  assert.equal(thistleGuestAccess(memory, 0, 1, moved + 4096n, 1, 1), -14);
  storeU32(memory, hartAt(0) + H_LOCK, 1);
  assert.equal(thistleUnmapHostFile(memory, 0, moved, 4096n), -11n);
  storeU32(memory, hartAt(0) + H_LOCK, 0);
  assert.equal(thistleUnmapHostFile(memory, 0, moved, 4096n), 0n);
  assert.equal(thistleUnmapHostFile(memory, 0, blocker, 4096n), 0n);
  assert.equal(thistleProcessMapCount(memory, 0), 0);
});
