import {
  C_MAX_HARTS, C_PROCESS_LOCK, H_EVENT, H_FAULT, H_FCSR, H_HOST_OPERATION,
  H_PROCESS_SLOT, H_RESERVATION, H_STATUS, H_X, H_F, H_EXIT_CODE,
  P_LEADER_HART, P_STATE, P_SEGMENT_COUNT, P_IMAGE_ENTRY,
  THISTLE_HART_EMPTY, THISTLE_HART_EXITED, THISTLE_HART_RUNNABLE,
  THISTLE_HART_WAITING, THISTLE_PROCESS_RUNNABLE, THISTLE_PROCESS_WAITING,
  THISTLE_PROCESS_ZOMBIE, THISTLE_EVENT_NONE,
} from "./abi.js";
import { atomicStoreI32, compareExchangeI32, fill, loadU32, loadU64, storeI64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { hartAt, INVALID_POINTER, lockProcessHarts, processForHart, unlockProcessHarts, validHart, validKernel } from "./state.js";
import type { I32, Ptr, U32 } from "./types.js";

const resetRegisters = (memory: ThistleMemory, at: Ptr): void => {
  fill(memory, at + H_X, 32 * 8, 0);
  fill(memory, at + H_F, 32 * 8, 0);
  atomicStoreI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_FAULT, 0);
  atomicStoreI32(memory, at + H_FCSR, 0);
  atomicStoreI32(memory, at + H_HOST_OPERATION, 0);
  atomicStoreI32(memory, at + H_EXIT_CODE, 0);
  storeI64(memory, at + H_RESERVATION, -1n);
};

const runImageLocked = (memory: ThistleMemory, hart: U32, proc: Ptr): I32 => {
  if (loadU32(memory, proc + P_SEGMENT_COUNT) === 0 || loadU64(memory, proc + P_IMAGE_ENTRY) < 0x10000n) return -22;
  atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  atomicStoreI32(memory, hartAt(hart) + H_STATUS, THISTLE_HART_RUNNABLE);
  return 0;
};

const parkLocked = (memory: ThistleMemory, hart: U32, proc: Ptr, operation: U32): I32 => {
  const at = hartAt(hart), slot = loadU32(memory, at + H_PROCESS_SLOT);
  const count = loadU32(memory, C_MAX_HARTS);
  let index: U32 = 0;
  while (index < count) {
    const current = hartAt(index);
    if (loadU32(memory, current + H_STATUS) !== THISTLE_HART_EMPTY && loadU32(memory, current + H_PROCESS_SLOT) === slot) {
      atomicStoreI32(memory, current + H_STATUS, operation === 1 && index !== hart ? THISTLE_HART_EXITED : THISTLE_HART_WAITING);
    }
    index += 1;
  }
  if (operation === 1) resetRegisters(memory, at);
  atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_WAITING);
  return 0;
};

// Hold the process and every bound hart lock across each complete transition.
const changeLocked = (memory: ThistleMemory, hart: U32, proc: Ptr, operation: U32): I32 => {
  if (loadU32(memory, proc + P_LEADER_HART) !== hart ||
      loadU32(memory, proc + P_STATE) === THISTLE_PROCESS_ZOMBIE) return -22;
  const slot = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
  if (!lockProcessHarts(memory, slot)) return -11;
  const result = operation === 2 ? runImageLocked(memory, hart, proc) : parkLocked(memory, hart, proc, operation);
  unlockProcessHarts(memory, slot, loadU32(memory, C_MAX_HARTS), INVALID_POINTER);
  return result;
};

const change = (memory: ThistleMemory, hart: U32, operation: U32): I32 => {
  if (!validKernel(memory) || !validHart(memory, hart)) return -22;
  if (compareExchangeI32(memory, C_PROCESS_LOCK, 0, 1) !== 0) return -11;
  const proc = processForHart(memory, hart);
  const result = proc === INVALID_POINTER ? -3 : changeLocked(memory, hart, proc, operation);
  atomicStoreI32(memory, C_PROCESS_LOCK, 0);
  return result;
};

/** Trusted host callback parking, with no instruction at address zero to schedule. */
export const thistleProcessPark = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 0);

/** Quiesce every process hart before an embedding replaces its executable image. */
export const thistleProcessPrepareImage = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 1);

/** Publish a fully loaded image as runnable through its existing process leader. */
export const thistleProcessRunImage = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 2);
