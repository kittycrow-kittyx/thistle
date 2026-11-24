import {
  C_ABI, C_MAGIC, THISTLE_ABI_VERSION, THISTLE_MAGIC, C_MAX_HARTS, C_PROCESS_CAPACITY, C_PROCESS_TABLE_BASE, H_PROCESS_SLOT, H_STATUS, THISTLE_HART_EMPTY, P_PID, P_STATE,
  H_LOCK,
  H_PAGE_TABLE, H_PAGE_CAPACITY, H_PAGE_COUNT, H_VIRTUAL_TOP, H_IMAGE_FLOOR,
  P_PAGE_TABLE, P_PAGE_CAPACITY, P_PAGE_COUNT, P_VIRTUAL_TOP, P_IMAGE_FLOOR,
  THISTLE_HART_BASE, THISTLE_HART_STRIDE, THISTLE_PROCESS_STRIDE,
} from "./abi.js";
import { atomicStoreI32, compareExchangeI32, loadU32, loadU64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { Ptr, U32 } from "./types.js";

export const INVALID_POINTER: Ptr = 0xffffffff;
export const hartAt = (hart: U32): Ptr => THISTLE_HART_BASE + hart * THISTLE_HART_STRIDE;
export const processAt = (memory: ThistleMemory, slot: U32): Ptr =>
  loadU32(memory, C_PROCESS_TABLE_BASE) + slot * THISTLE_PROCESS_STRIDE;
export const validHart = (memory: ThistleMemory, hart: U32): boolean =>
  hart < loadU32(memory, C_MAX_HARTS);
export const processForHart = (memory: ThistleMemory, hart: U32): Ptr => {
  if (!validHart(memory, hart) || loadU32(memory, hartAt(hart) + H_STATUS) === THISTLE_HART_EMPTY) return INVALID_POINTER;
  const slot = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
  return slot < loadU32(memory, C_PROCESS_CAPACITY) ? processAt(memory, slot) : INVALID_POINTER;
};

export const processSlotByPid = (memory: ThistleMemory, pid: U32): U32 => {
  const capacity = loadU32(memory, C_PROCESS_CAPACITY);
  let slot: U32 = 0;
  while (slot < capacity) {
    const proc = processAt(memory, slot);
    if (loadU32(memory, proc + P_STATE) !== 0 && loadU32(memory, proc + P_PID) === pid) return slot;
    slot += 1;
  }
  return INVALID_POINTER;
};

export const validKernel = (memory: ThistleMemory): boolean =>
  loadU32(memory, C_MAGIC) === THISTLE_MAGIC && loadU32(memory, C_ABI) === THISTLE_ABI_VERSION;

/** Bind a hart view to existing canonical process storage under caller locks. */
export const bindProcess = (memory: ThistleMemory, hart: U32, slot: U32): void => {
  const proc = processAt(memory, slot), at = hartAt(hart);
  storeU32(memory, at + H_PROCESS_SLOT, slot);
  storeU32(memory, at + H_PAGE_TABLE, loadU32(memory, proc + P_PAGE_TABLE));
  storeU32(memory, at + H_PAGE_CAPACITY, loadU32(memory, proc + P_PAGE_CAPACITY));
  storeU32(memory, at + H_PAGE_COUNT, loadU32(memory, proc + P_PAGE_COUNT));
  storeU64(memory, at + H_VIRTUAL_TOP, loadU64(memory, proc + P_VIRTUAL_TOP));
  storeU64(memory, at + H_IMAGE_FLOOR, loadU64(memory, proc + P_IMAGE_FLOOR));
};

export const unlockProcessHarts = (memory: ThistleMemory, slot: U32, end: U32, except: U32): void => {
  let hart: U32 = 0;
  while (hart < end) {
    if (hart !== except && loadU32(memory, hartAt(hart) + H_PROCESS_SLOT) === slot) atomicStoreI32(memory, hartAt(hart) + H_LOCK, 0);
    hart += 1;
  }
};

export const lockProcessHarts = (memory: ThistleMemory, slot: U32): boolean => {
  const count = loadU32(memory, C_MAX_HARTS);
  let hart: U32 = 0;
  while (hart < count) {
    const owner = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
    if (owner === slot && compareExchangeI32(memory, hartAt(hart) + H_LOCK, 0, 1) !== 0) {
      unlockProcessHarts(memory, slot, hart, INVALID_POINTER);
      return false;
    }
    hart += 1;
  }
  return true;
};
