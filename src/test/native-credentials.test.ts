import assert from "node:assert/strict";
import { test } from "node:test";
import {
  P_EUID, C_PHYSICAL_END, C_PHYSICAL_NEXT, C_VFS_LOCK, P_GROUP_COUNT, P_GROUP_DATA,
  P_FSUID, P_FSGID, THISTLE_BATCH_BUDGET, THISTLE_SEGMENT_READ,
  THISTLE_SEGMENT_WRITE, THISTLE_SEGMENT_EXECUTE, THISTLE_VFS_KIND_FILE,
} from "../native/abi.js";
import { loadU32, storeU32 } from "../native/memory.js";
import {
  thistleImageReserve, thistleImageRelease, thistleImageBegin, thistleImageSegment,
  thistleImageFinish, thistleHartSetPc, thistleHartSetX, thistleHartGetX,
  thistleRunRv64Batch, thistleGuestPage,
} from "../native/kernel.js";
import { thistleProcessInstallCredentials, thistleProcessGroups, thistleProcessIdentity, thistleProcessReadGroups, thistleProcessRecord, thistleProcessSetGroup } from "../native/process-state.js";
import { readGroup } from "../native/credentials.js";
import { thistleVfsAccess } from "../native/vfs.js";
import { thistleVfsCreate, thistleVfsChown } from "../native/vfs-edit.js";
import { mountedKernel } from "./vfs-fixture.js";

test("supplementary groups span frames and control canonical VFS access", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  const initial = loadU32(memory, C_PHYSICAL_NEXT), count = 16500;
  const input = thistleImageReserve(memory, count * 4);
  for (let index = 0; index < count; index++) storeU32(memory, input + index * 4, index + 100);
  assert.equal(thistleProcessGroups(memory, 0, input, count), 0);
  for (const index of [0, 31, 32, 16414, 16415, 16499]) assert.equal(readGroup(memory, proc, index), index + 100);
  assert.equal(thistleProcessReadGroups(memory, 0, 0, 0), count);
  assert.equal(thistleProcessReadGroups(memory, 0, input, count - 1), -34);
  assert.equal(thistleProcessReadGroups(memory, 0, input, count), count);
  for (let index = 0; index < count; index++) assert.equal(loadU32(memory, input + index * 4), index + 100);
  memory.bytes.set([102], input);
  const inode = thistleVfsCreate(memory, proc, 1, input, 1, THISTLE_VFS_KIND_FILE, 0o040, 0n);
  assert.ok(inode > 1);
  assert.equal(thistleVfsChown(memory, proc, inode, 99999, count + 99, 0n), 0);
  storeU32(memory, proc + P_FSUID, 1000); storeU32(memory, proc + P_FSGID, 1000);
  assert.equal(thistleVfsAccess(memory, proc, inode, 4), true);
  assert.equal(thistleVfsAccess(memory, proc, inode, 2), false);
  assert.equal(thistleProcessGroups(memory, 0, input, 0), 0);
  assert.equal(thistleVfsAccess(memory, proc, inode, 4), false);
  assert.equal(loadU32(memory, proc + P_GROUP_DATA), 0);
  assert.equal(loadU32(memory, C_PHYSICAL_NEXT), initial);
  assert.equal(thistleImageRelease(memory, input, count * 4), 0);
});

test("group replacement preserves the previous vector on allocation failure and contention", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  for (let index = 0; index < 40; index++) assert.equal(thistleProcessSetGroup(memory, 0, index, index + 1), 0);
  const head = loadU32(memory, proc + P_GROUP_DATA), next = loadU32(memory, C_PHYSICAL_NEXT);
  const end = loadU32(memory, C_PHYSICAL_END);
  storeU32(memory, C_PHYSICAL_END, next + 176);
  const input = thistleImageReserve(memory, 160);
  assert.notEqual(input, 0xffffffff);
  for (let index = 0; index < 40; index++) storeU32(memory, input + index * 4, 100 + index);
  assert.equal(thistleProcessGroups(memory, 0, input, 40), -12);
  storeU32(memory, C_VFS_LOCK, 1);
  assert.equal(thistleProcessGroups(memory, 0, input, 40), -11);
  storeU32(memory, C_VFS_LOCK, 0);
  assert.equal(loadU32(memory, proc + P_GROUP_DATA), head);
  assert.equal(loadU32(memory, C_PHYSICAL_NEXT), next);
  assert.equal(loadU32(memory, proc + P_GROUP_COUNT), 40);
  for (let index = 0; index < 40; index++) assert.equal(readGroup(memory, proc, index), index + 1);
  storeU32(memory, input + 39 * 4, 0xffffffff);
  assert.equal(thistleProcessGroups(memory, 0, input, 40), -22);
  assert.equal(thistleImageRelease(memory, input, 160), 0);
  storeU32(memory, C_PHYSICAL_END, end);
});

test("RV64 credential syscalls share host policy and transfer extended group vectors", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  const code = thistleImageReserve(memory, 4);
  storeU32(memory, code, 0x73);
  assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
  assert.equal(thistleImageSegment(memory, 0, 1, 1, 0x200000n, 4n, THISTLE_SEGMENT_READ | THISTLE_SEGMENT_EXECUTE, code, 4), 0);
  assert.equal(thistleImageSegment(memory, 0, 2, 1, 0x210000n, 4096n, THISTLE_SEGMENT_READ | THISTLE_SEGMENT_WRITE, code, 0), 0);
  assert.equal(thistleImageFinish(memory, 0, 7), 0);
  assert.equal(thistleImageRelease(memory, code, 4), 0);
  const page = thistleGuestPage(memory, 0, 0x210000n, true);
  for (let index = 0; index < 40; index++) storeU32(memory, page + index * 4, index + 100);
  const call = (number: number, first: bigint, second = 0n, third = 0n): bigint => {
    thistleHartSetPc(memory, 0, 0x200000n);
    thistleHartSetX(memory, 0, 17, BigInt(number));
    thistleHartSetX(memory, 0, 10, first); thistleHartSetX(memory, 0, 11, second); thistleHartSetX(memory, 0, 12, third);
    assert.equal(thistleRunRv64Batch(memory, 0, 1, 0n, -1), THISTLE_BATCH_BUDGET);
    return thistleHartGetX(memory, 0, 10);
  };
  assert.equal(call(159, 40n, 0x210000n), 0n);
  assert.equal(readGroup(memory, proc, 39), 139);
  assert.equal(call(158, 0n), 40n);
  assert.equal(call(158, 40n, 0x210100n), 40n);
  assert.equal(loadU32(memory, page + 0x100 + 39 * 4), 139);
  assert.equal(call(147, 0xfffffffen, 0n, 0n), 0n);
  assert.equal(call(174, 0n), 0xfffffffen);
  assert.equal(call(147, 1000n, 0n, 0n), 0n);
  assert.equal(thistleProcessIdentity(memory, 0, 2, 0xffffffff, 1000, 0xffffffff), 0n);
  assert.equal(call(146, 2000n), -1n);
  assert.equal(call(146, -1n), -22n);
  assert.equal(call(151, -1n), -22n);
  assert.equal(call(146, 0n), 0n);
  assert.equal(call(159, 0n), 0n);
  assert.equal(loadU32(memory, proc + P_GROUP_DATA), 0);
});

test("trusted credential installation publishes IDs and groups as one batch", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  const input = thistleImageReserve(memory, 196);
  for (let index = 0; index < 8; index++) storeU32(memory, input + index * 4, 100 + index);
  storeU32(memory, input + 32, 40);
  for (let index = 0; index < 40; index++) storeU32(memory, input + 36 + index * 4, 1000 + index);
  assert.equal(thistleProcessInstallCredentials(memory, 0, input), 0);
  assert.equal(loadU32(memory, proc + P_EUID), 101);
  assert.equal(loadU32(memory, proc + P_FSUID), 103);
  assert.equal(readGroup(memory, proc, 39), 1039);
  storeU32(memory, input + 4, 200);
  storeU32(memory, input + 36 + 39 * 4, 0xffffffff);
  assert.equal(thistleProcessInstallCredentials(memory, 0, input), -22);
  assert.equal(loadU32(memory, proc + P_EUID), 101);
  assert.equal(readGroup(memory, proc, 39), 1039);
  assert.equal(thistleImageRelease(memory, input, 196), 0);
  const end = loadU32(memory, C_PHYSICAL_END), next = loadU32(memory, C_PHYSICAL_NEXT);
  storeU32(memory, C_PHYSICAL_END, next + 224);
  const limited = thistleImageReserve(memory, 196);
  assert.notEqual(limited, 0xffffffff);
  for (let index = 0; index < 8; index++) storeU32(memory, limited + index * 4, 200 + index);
  storeU32(memory, limited + 32, 40);
  for (let index = 0; index < 40; index++) storeU32(memory, limited + 36 + index * 4, 2000 + index);
  assert.equal(thistleProcessInstallCredentials(memory, 0, limited), -12);
  assert.equal(loadU32(memory, proc + P_EUID), 101);
  assert.equal(readGroup(memory, proc, 39), 1039);
  assert.equal(thistleImageRelease(memory, limited, 196), 0);
  storeU32(memory, C_PHYSICAL_END, end);
});
