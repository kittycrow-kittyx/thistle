import {
  C_MAX_HARTS, C_PROCESS_LOCK, C_VFS_LOCK, H_LOCK, H_STATUS, H_EVENT, H_PROCESS_SLOT,
  H_PC, H_X, H_F, H_FCSR, H_RESERVATION, H_STACK_BOTTOM, H_STACK_POINTER,
  P_LOCK, P_PID, P_PPID, P_STATE, P_LEADER_HART, P_PAGE_TABLE, P_PAGE_COUNT, P_SEGMENT_COUNT,
  P_MAP_COUNT, P_CWD_INODE, P_VIRTUAL_TOP, P_STACK_BOTTOM, P_STACK_POINTER,
  P_VFORK_CHILD, P_VFORK_PARENT, THISTLE_EVENT_NONE, THISTLE_EVENT_SYSCALL,
  THISTLE_HART_WAITING, THISTLE_HART_RUNNABLE, THISTLE_HART_EXITED,
  THISTLE_PROCESS_WAITING, THISTLE_PROCESS_RUNNABLE, THISTLE_PROCESS_ZOMBIE,
} from "./abi.js";
import { hasDirtyRange } from "./arena.js";
import { atomicStoreI32, compareExchangeI32, copyMemory, loadU32, loadU64, storeI64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { bindProcess, hartAt, INVALID_POINTER, processAt, processForHart, processSlotByPid, validHart, validKernel } from "./state.js";
import type { I32, Ptr, U32, U64 } from "./types.js";
import { word } from "./word.js";

const acquire = (memory: ThistleMemory, address: Ptr): boolean =>
  compareExchangeI32(memory, address, 0, 1) === 0;

const release = (memory: ThistleMemory, address: Ptr): void => atomicStoreI32(memory, address, 0);

// A vfork lease transfers the actual table ownership to the child temporarily.
// The parked parent's table pointers cannot be recycled until the lease ends.
const swapAddressSpace = (memory: ThistleMemory, parent: Ptr, child: Ptr): void => {
  let offset: U32 = P_PAGE_TABLE;
  while (offset < P_CWD_INODE) {
    if (offset === P_VFORK_PARENT) { offset += 4; continue; }
    const value = loadU32(memory, parent + offset);
    storeU32(memory, parent + offset, loadU32(memory, child + offset));
    storeU32(memory, child + offset, value);
    offset += 4;
  }
};

const syncHart = (memory: ThistleMemory, hart: U32, proc: Ptr): void => {
  const at = hartAt(hart);
  bindProcess(memory, hart, loadU32(memory, at + H_PROCESS_SLOT));
  storeU64(memory, at + H_STACK_BOTTOM, loadU64(memory, proc + P_STACK_BOTTOM));
  storeU64(memory, at + H_STACK_POINTER, loadU64(memory, proc + P_STACK_POINTER));
};

const soleHart = (memory: ThistleMemory, hart: U32): boolean => {
  const slot = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
  const count = loadU32(memory, C_MAX_HARTS);
  let index: U32 = 0;
  while (index < count) {
    if (index !== hart && loadU32(memory, hartAt(index) + H_PROCESS_SLOT) === slot) return false;
    index += 1;
  }
  return true;
};

// All callers hold C_PROCESS_LOCK; this keeps both process slots alive.
const lockPair = (memory: ThistleMemory, parentHart: U32, childHart: U32, parent: Ptr, child: Ptr): boolean => {
  const parentLock = hartAt(parentHart) + H_LOCK, childLock = hartAt(childHart) + H_LOCK;
  if (!acquire(memory, parentLock)) return false;
  if (!acquire(memory, childLock)) { release(memory, parentLock); return false; }
  if (!acquire(memory, parent + P_LOCK)) {
    release(memory, childLock); release(memory, parentLock); return false;
  }
  if (!acquire(memory, child + P_LOCK)) {
    release(memory, parent + P_LOCK); release(memory, childLock); release(memory, parentLock); return false;
  }
  if (!acquire(memory, C_VFS_LOCK)) {
    release(memory, child + P_LOCK); release(memory, parent + P_LOCK);
    release(memory, childLock); release(memory, parentLock); return false;
  }
  return true;
};

const unlockPair = (memory: ThistleMemory, parentHart: U32, childHart: U32, parent: Ptr, child: Ptr): void => {
  release(memory, C_VFS_LOCK);
  release(memory, child + P_LOCK); release(memory, parent + P_LOCK);
  release(memory, hartAt(childHart) + H_LOCK); release(memory, hartAt(parentHart) + H_LOCK);
};

const beginStatus = (memory: ThistleMemory, parentHart: U32, childHart: U32, parent: Ptr, child: Ptr): I32 => {
  if (loadU32(memory, parent + P_LEADER_HART) !== parentHart || loadU32(memory, child + P_LEADER_HART) !== childHart ||
      !soleHart(memory, parentHart) || !soleHart(memory, childHart)) return -95;
  if (loadU32(memory, parent + P_VFORK_CHILD) !== 0 || loadU32(memory, parent + P_VFORK_PARENT) !== 0 ||
      loadU32(memory, child + P_VFORK_CHILD) !== 0 || loadU32(memory, child + P_VFORK_PARENT) !== 0) return -16;
  if (loadU32(memory, child + P_PPID) !== loadU32(memory, parent + P_PID)) return -10;
  const source = hartAt(parentHart), target = hartAt(childHart);
  if (loadU32(memory, source + H_STATUS) !== THISTLE_HART_WAITING ||
      loadU32(memory, source + H_EVENT) !== THISTLE_EVENT_SYSCALL ||
      loadU32(memory, parent + P_STATE) !== THISTLE_PROCESS_WAITING ||
      loadU32(memory, target + H_STATUS) !== THISTLE_HART_WAITING ||
      loadU32(memory, child + P_STATE) !== THISTLE_PROCESS_WAITING) return -22;
  if (loadU32(memory, child + P_PAGE_COUNT) !== 0 || loadU32(memory, child + P_SEGMENT_COUNT) !== 0 ||
      loadU32(memory, child + P_MAP_COUNT) !== 0 || loadU32(memory, parent + P_SEGMENT_COUNT) === 0) return -16;
  return hasDirtyRange(memory, parent, 0n, loadU64(memory, parent + P_VIRTUAL_TOP)) ? -16 : 0;
};

const startChild = (memory: ThistleMemory, parentHart: U32, childHart: U32, stack: U64, tls: U64, flags: U64): void => {
  const source = hartAt(parentHart), target = hartAt(childHart);
  copyMemory(memory, target + H_X, source + H_X, 32 * 8);
  copyMemory(memory, target + H_F, source + H_F, 32 * 8);
  storeU64(memory, target + H_PC, loadU64(memory, source + H_PC));
  storeU32(memory, target + H_FCSR, loadU32(memory, source + H_FCSR));
  storeI64(memory, target + H_RESERVATION, -1n);
  storeI64(memory, target + H_X + 10 * 8, 0n);
  if (stack !== 0n) storeU64(memory, target + H_X + 2 * 8, stack);
  if ((flags & 0x80000n) !== 0n) storeU64(memory, target + H_X + 4 * 8, tls);
  atomicStoreI32(memory, target + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, target + H_STATUS, THISTLE_HART_RUNNABLE);
};

const beginLocked = (memory: ThistleMemory, parentHart: U32, childHart: U32, stack: U64, tls: U64, flags: U64): I32 => {
  const parent = processForHart(memory, parentHart), child = processForHart(memory, childHart);
  if (parent === INVALID_POINTER || child === INVALID_POINTER || parent === child) return -3;
  if (!lockPair(memory, parentHart, childHart, parent, child)) return -11;
  const status = beginStatus(memory, parentHart, childHart, parent, child);
  const top = loadU64(memory, parent + P_VIRTUAL_TOP);
  if (status !== 0 || stack >= top) {
    unlockPair(memory, parentHart, childHart, parent, child);
    return status !== 0 ? status : -14;
  }
  swapAddressSpace(memory, parent, child);
  storeU32(memory, parent + P_VFORK_CHILD, loadU32(memory, child + P_PID));
  storeU32(memory, child + P_VFORK_PARENT, loadU32(memory, parent + P_PID));
  syncHart(memory, parentHart, parent);
  syncHart(memory, childHart, child);
  startChild(memory, parentHart, childHart, stack, tls, flags);
  atomicStoreI32(memory, child + P_STATE, THISTLE_PROCESS_RUNNABLE);
  unlockPair(memory, parentHart, childHart, parent, child);
  return 0;
};

/** Start a single-hart vfork child with an existing process record and retained descriptors. */
export const thistleVforkBegin = (memory: ThistleMemory, parentHart: U32, childHart: U32, stack: U64, tls: U64, flags: U64): I32 => {
  if (!validKernel(memory) || !validHart(memory, parentHart) || !validHart(memory, childHart)) return -22;
  const signal = flags & 255n;
  if ((flags & 0x4100n) !== 0x4100n || (flags & ~0x841ffn) !== 0n || (signal !== 0n && signal !== 17n)) return -95;
  if (!acquire(memory, C_PROCESS_LOCK)) return -11;
  const result = beginLocked(memory, parentHart, childHart, stack, tls, flags);
  release(memory, C_PROCESS_LOCK);
  return result;
};

const restoreParent = (memory: ThistleMemory, hart: U32, parent: Ptr, childPid: U32): void => {
  if (loadU32(memory, parent + P_STATE) === THISTLE_PROCESS_ZOMBIE) return;
  const at = hartAt(hart);
  storeI64(memory, at + H_X + 10 * 8, word(childPid));
  atomicStoreI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_RUNNABLE);
  atomicStoreI32(memory, parent + P_STATE, THISTLE_PROCESS_RUNNABLE);
};

const finishLease = (memory: ThistleMemory, parentHart: U32, childHart: U32, parent: Ptr, child: Ptr): void => {
  swapAddressSpace(memory, parent, child);
  storeU32(memory, parent + P_VFORK_CHILD, 0);
  storeU32(memory, child + P_VFORK_PARENT, 0);
  syncHart(memory, parentHart, parent);
  syncHart(memory, childHart, child);
  const target = hartAt(childHart);
  if (loadU32(memory, child + P_STATE) !== THISTLE_PROCESS_ZOMBIE) {
    atomicStoreI32(memory, target + H_STATUS, THISTLE_HART_WAITING);
    atomicStoreI32(memory, child + P_STATE, THISTLE_PROCESS_WAITING);
  }
  atomicStoreI32(memory, target + H_EVENT, THISTLE_EVENT_NONE);
  restoreParent(memory, parentHart, parent, loadU32(memory, child + P_PID));
};

const releaseLocked = (memory: ThistleMemory, childHart: U32, child: Ptr): I32 => {
  const parentPid = loadU32(memory, child + P_VFORK_PARENT);
  if (parentPid === 0) return -22;
  const slot = processSlotByPid(memory, parentPid);
  if (slot === INVALID_POINTER) return -3;
  const parent = processAt(memory, slot), parentHart = loadU32(memory, parent + P_LEADER_HART);
  if (loadU32(memory, parent + P_VFORK_CHILD) !== loadU32(memory, child + P_PID)) return -3;
  if (!lockPair(memory, parentHart, childHart, parent, child)) return -11;
  if (hasDirtyRange(memory, child, 0n, loadU64(memory, child + P_VIRTUAL_TOP))) {
    unlockPair(memory, parentHart, childHart, parent, child);
    return -16;
  }
  finishLease(memory, parentHart, childHart, parent, child);
  unlockPair(memory, parentHart, childHart, parent, child);
  return 0;
};

/** Return the exact address space to its parent before child exec or final reaping. */
export const thistleVforkRelease = (memory: ThistleMemory, childHart: U32): I32 => {
  if (!validKernel(memory) || !validHart(memory, childHart)) return -22;
  if (!acquire(memory, C_PROCESS_LOCK)) return -11;
  const child = processForHart(memory, childHart);
  const result = child === INVALID_POINTER ? -3 : releaseLocked(memory, childHart, child);
  release(memory, C_PROCESS_LOCK);
  return result;
};
