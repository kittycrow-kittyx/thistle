import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingKernel } from "./vfs-fixture.js";
import { thistleGuestPage, thistleHartInit, thistleProcessInit, thistleProcessPark, thistleProcessRecord,
  thistleProcessFinish, thistleProcessReap, thistleResumeSyscall, thistleVforkBegin, thistleVforkRelease,
  thistleHartGetX, thistleHartStatus, thistleProcessPrepareImage, thistleProcessAttach, thistleImageBegin } from "../native/kernel.js";
import { H_STATUS, H_EVENT, H_X, P_STATE, P_PAGE_TABLE, P_VFORK_CHILD, P_VFORK_PARENT,
  THISTLE_HART_WAITING, THISTLE_EVENT_SYSCALL, THISTLE_PROCESS_WAITING, THISTLE_HART_RUNNABLE, THISTLE_THX_BUSY } from "../native/abi.js";
import { hartAt } from "../native/state.js";
import { loadU32, storeU32, storeU64 } from "../native/memory.js";

test("vfork transfers one address space and restores native parent registers", () => {
  const memory = mappingKernel(3), parent = thistleProcessRecord(memory, 0);
  const address = 0x200000n, page = thistleGuestPage(memory, 0, address, true);
  memory.bytes[page] = 17;
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 0, 0, 0, 0, 0, 0), 0);
  assert.equal(thistleProcessPark(memory, 1), 0);
  const child = thistleProcessRecord(memory, 1);
  const parentTable = loadU32(memory, parent + P_PAGE_TABLE), childTable = loadU32(memory, child + P_PAGE_TABLE);
  storeU32(memory, hartAt(0) + H_STATUS, THISTLE_HART_WAITING);
  storeU32(memory, hartAt(0) + H_EVENT, THISTLE_EVENT_SYSCALL);
  storeU32(memory, parent + P_STATE, THISTLE_PROCESS_WAITING);
  storeU64(memory, hartAt(0) + H_X + 5 * 8, 123n);
  assert.equal(thistleVforkBegin(memory, 0, 1, 0n, 0n, 0x4111n), 0);
  assert.equal(loadU32(memory, parent + P_VFORK_CHILD), 2);
  assert.equal(loadU32(memory, child + P_VFORK_PARENT), 1);
  assert.equal(loadU32(memory, parent + P_PAGE_TABLE), childTable);
  assert.equal(loadU32(memory, child + P_PAGE_TABLE), parentTable);
  assert.equal(thistleHartGetX(memory, 1, 10), 0n);
  assert.equal(thistleHartGetX(memory, 1, 5), 123n);
  assert.equal(thistleGuestPage(memory, 1, address, false), page);
  memory.bytes[page] = 42;
  assert.notEqual(thistleResumeSyscall(memory, 0, 2n), 0);
  assert.equal(thistleProcessPrepareImage(memory, 1), -16);
  assert.equal(thistleImageBegin(memory, 1, 0x10000000n, 0x10000n, 0n, 0, 0), THISTLE_THX_BUSY);
  assert.equal(thistleHartInit(memory, 2, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessAttach(memory, 2, 2), -16);
  assert.equal(thistleProcessAttach(memory, 2, 1), -16);
  assert.equal(thistleProcessFinish(memory, 1, 2, 7), 0);
  assert.equal(thistleProcessReap(memory, 0, 2), -16);
  assert.equal(thistleVforkRelease(memory, 1), 0);
  assert.equal(loadU32(memory, parent + P_PAGE_TABLE), parentTable);
  assert.equal(loadU32(memory, child + P_PAGE_TABLE), childTable);
  assert.equal(thistleHartStatus(memory, 0), THISTLE_HART_RUNNABLE);
  assert.equal(thistleHartGetX(memory, 0, 10), 2n);
  assert.equal(thistleHartGetX(memory, 0, 5), 123n);
  assert.equal(thistleGuestPage(memory, 0, address, false), page);
  assert.equal(memory.view.getUint8(page), 42);
  assert.equal(thistleProcessReap(memory, 0, 2), 0);
  assert.equal(memory.view.getUint8(page), 42);
});
