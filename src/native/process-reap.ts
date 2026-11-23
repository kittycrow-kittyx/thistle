import {
  C_CREDENTIAL_LOCK, C_MAX_HARTS, C_MEMORY_LOCK, C_PROCESS_COUNT, C_PROCESS_LOCK,
  C_VFS_LOCK, FD_INODE, H_LOCK, H_PROCESS_SLOT, P_DESCRIPTOR_CAPACITY,
  P_DESCRIPTOR_TABLE, P_EUID, P_PAGE_CAPACITY, P_PAGE_TABLE, P_PID, P_PPID,
  P_STATE, THISTLE_DESCRIPTOR_STRIDE, THISTLE_HART_STRIDE, THISTLE_PAGE_ENTRY_SIZE,
  THISTLE_PROCESS_STRIDE, THISTLE_PROCESS_ZOMBIE,
} from "./abi.js";
import { releaseFrame, trimFreeFrames, validFrame } from "./arena.js";
import { releaseGroups } from "./credentials.js";
import { atomicStoreI32, compareExchangeI32, fill, loadU32, loadU64, storeU32 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { INVALID_POINTER, hartAt, processAt, processForHart, processSlotByPid, validHart, validKernel } from "./state.js";
import type { I32, Ptr, U32 } from "./types.js";
import { thistleVfsRelease } from "./vfs.js";
import { word, wordToU32 } from "./word.js";

const unlockProcessHarts = (memory: ThistleMemory, slot: U32, end: U32): void => {
  let hart: U32 = 0;
  while (hart < end) {
    if (loadU32(memory, hartAt(hart) + H_PROCESS_SLOT) === slot) atomicStoreI32(memory, hartAt(hart) + H_LOCK, 0);
    hart += 1;
  }
};

const lockProcessHarts = (memory: ThistleMemory, slot: U32): boolean => {
  const count = loadU32(memory, C_MAX_HARTS);
  let hart: U32 = 0;
  while (hart < count) {
    const owner = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
    if (owner === slot && compareExchangeI32(memory, hartAt(hart) + H_LOCK, 0, 1) !== 0) {
      unlockProcessHarts(memory, slot, hart);
      return false;
    }
    hart += 1;
  }
  return true;
};

const validProcessFrames = (memory: ThistleMemory, proc: Ptr): boolean => {
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const count = loadU32(memory, proc + P_PAGE_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const entry = table + index * THISTLE_PAGE_ENTRY_SIZE;
    const frame = loadU32(memory, entry + 8);
    if (loadU64(memory, entry) !== 0n &&
        !validFrame(memory, frame)) return false;
    index += 1;
  }
  return true;
};

const releaseProcessDescriptors = (memory: ThistleMemory, proc: Ptr): void => {
  const table = loadU32(memory, proc + P_DESCRIPTOR_TABLE);
  const count = loadU32(memory, proc + P_DESCRIPTOR_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const at = table + index * THISTLE_DESCRIPTOR_STRIDE;
    const inode = loadU32(memory, at + FD_INODE);
    fill(memory, at, THISTLE_DESCRIPTOR_STRIDE, 0);
    thistleVfsRelease(memory, inode);
    index += 1;
  }
};

const releaseProcessFrames = (memory: ThistleMemory, proc: Ptr): void => {
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const count = loadU32(memory, proc + P_PAGE_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const entry = table + index * THISTLE_PAGE_ENTRY_SIZE;
    if (loadU64(memory, entry) !== 0n) {
      const frame = loadU32(memory, entry + 8);
      releaseFrame(memory, frame);
    }
    index += 1;
  }
  fill(memory, table, count * THISTLE_PAGE_ENTRY_SIZE, 0);
};

const clearProcessHarts = (memory: ThistleMemory, slot: U32): void => {
  const count = loadU32(memory, C_MAX_HARTS);
  let hart: U32 = 0;
  while (hart < count) {
    const at = hartAt(hart);
    if (loadU32(memory, at + H_PROCESS_SLOT) === slot) {
      fill(memory, at, THISTLE_HART_STRIDE, 0);
      storeU32(memory, at + H_PROCESS_SLOT, INVALID_POINTER);
    }
    hart += 1;
  }
};

const reapResources = (memory: ThistleMemory, proc: Ptr, slot: U32): I32 => {
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11;
  if (compareExchangeI32(memory, C_MEMORY_LOCK, 0, 1) !== 0) { atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -11; }
  if (compareExchangeI32(memory, C_VFS_LOCK, 0, 1) !== 0) {
    atomicStoreI32(memory, C_MEMORY_LOCK, 0); atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -11;
  }
  if (!validProcessFrames(memory, proc)) {
    atomicStoreI32(memory, C_VFS_LOCK, 0); atomicStoreI32(memory, C_MEMORY_LOCK, 0); atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -14;
  }
  releaseProcessDescriptors(memory, proc);
  releaseProcessFrames(memory, proc);
  releaseGroups(memory, proc);
  trimFreeFrames(memory);
  clearProcessHarts(memory, slot);
  fill(memory, proc, THISTLE_PROCESS_STRIDE, 0);
  storeU32(memory, C_PROCESS_COUNT, loadU32(memory, C_PROCESS_COUNT) - 1);
  atomicStoreI32(memory, C_VFS_LOCK, 0); atomicStoreI32(memory, C_MEMORY_LOCK, 0); atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return 0;
};

const reapProcess = (memory: ThistleMemory, parent: Ptr, pid: U32): I32 => {
  const slot = processSlotByPid(memory, pid);
  if (slot === INVALID_POINTER) return -3;
  const proc = processAt(memory, slot);
  if (loadU32(memory, parent + P_EUID) !== 0 && loadU32(memory, proc + P_PPID) !== loadU32(memory, parent + P_PID)) return -10;
  if (loadU32(memory, proc + P_STATE) !== wordToU32(word(THISTLE_PROCESS_ZOMBIE))) return -11;
  if (!lockProcessHarts(memory, slot)) return -11;
  const result = reapResources(memory, proc, slot);
  unlockProcessHarts(memory, slot, loadU32(memory, C_MAX_HARTS));
  return result;
};

/** Reap a zombie through the canonical owner and recycle its descriptors/frames. */
export const thistleProcessReap = (memory: ThistleMemory, parentHart: U32, pid: U32): I32 => {
  if (!validKernel(memory) || !validHart(memory, parentHart)) return -22;
  if (pid <= 1) return -1;
  const parent = processForHart(memory, parentHart);
  if (parent === INVALID_POINTER) return -3;
  if (compareExchangeI32(memory, C_PROCESS_LOCK, 0, 1) !== 0) return -11;
  const result = reapProcess(memory, parent, pid);
  atomicStoreI32(memory, C_PROCESS_LOCK, 0);
  return result;
};

