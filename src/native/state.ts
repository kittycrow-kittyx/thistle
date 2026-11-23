import {
  C_ABI, C_MAGIC, THISTLE_ABI_VERSION, THISTLE_MAGIC, C_MAX_HARTS, C_PROCESS_CAPACITY, C_PROCESS_TABLE_BASE, H_PROCESS_SLOT, H_STATUS, THISTLE_HART_EMPTY, P_PID, P_STATE,
  THISTLE_HART_BASE, THISTLE_HART_STRIDE, THISTLE_PROCESS_STRIDE,
} from "./abi.js";
import { loadU32 } from "./memory.js";
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
