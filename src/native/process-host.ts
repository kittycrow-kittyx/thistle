import {
  C_MAX_HARTS, C_PROCESS_LOCK, H_EVENT, H_FAULT, H_FCSR, H_HOST_OPERATION,
  H_PROCESS_SLOT, H_RESERVATION, H_STATUS, H_X, H_F, H_EXIT_CODE,
  P_LEADER_HART, P_STATE, P_PID, P_EXIT_CODE, P_SEGMENT_COUNT, P_IMAGE_ENTRY,
  P_SIGNAL_PENDING, P_SIGNAL_LAST, P_SIGNAL_MASK,
  THISTLE_HART_EMPTY, THISTLE_HART_EXITED, THISTLE_HART_RUNNABLE,
  THISTLE_HART_WAITING, THISTLE_PROCESS_RUNNABLE, THISTLE_PROCESS_WAITING,
  THISTLE_PROCESS_ZOMBIE, THISTLE_PROCESS_RUNNING, THISTLE_PROCESS_STOPPED, THISTLE_EVENT_NONE,
} from "./abi.js";
import { atomicLoadU64, atomicStoreU64, atomicStoreI32, compareExchangeI32, fill, loadU32, loadU64, storeI64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { hartAt, INVALID_POINTER, lockProcessHarts, processForHart, unlockProcessHarts, validHart, validKernel } from "./state.js";
import type { I32, Ptr, U32 } from "./types.js";
import { word } from "./word.js";
import { inputContains } from "./arena.js";

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

const finishLocked = (memory: ThistleMemory, proc: Ptr, slot: U32, code: I32): I32 => {
  const count = loadU32(memory, C_MAX_HARTS);
  let hart: U32 = 0;
  while (hart < count) {
    const at = hartAt(hart);
    if (loadU32(memory, at + H_STATUS) !== THISTLE_HART_EMPTY && loadU32(memory, at + H_PROCESS_SLOT) === slot) {
      storeI64(memory, at + H_X + 10 * 8, word(code));
      atomicStoreI32(memory, at + H_EXIT_CODE, code);
      atomicStoreI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
      atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_EXITED);
    }
    hart += 1;
  }
  atomicStoreI32(memory, proc + P_EXIT_CODE, code);
  atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_ZOMBIE);
  return 0;
};

const setHostStateLocked = (memory: ThistleMemory, proc: Ptr, state: I32): I32 => {
  if (state !== THISTLE_PROCESS_RUNNABLE && state !== THISTLE_PROCESS_WAITING &&
      state !== THISTLE_PROCESS_RUNNING && state !== THISTLE_PROCESS_STOPPED) return -22;
  // A sleeping host syscall must not park sibling guest harts; their readiness remains per hart.
  atomicStoreI32(memory, proc + P_STATE, state);
  return 0;
};

const validSignal = (signal: I32): boolean =>
  signal === 0 || signal === 1 || signal === 2 || signal === 9 || signal === 13 || signal === 15;

const queueSignalLocked = (memory: ThistleMemory, proc: Ptr, signal: I32): I32 => {
  if (!validSignal(signal)) return -22;
  if (signal === 0) return 1;
  if (loadU32(memory, proc + P_STATE) === THISTLE_PROCESS_ZOMBIE) return 0;
  const blocked = atomicLoadU64(memory, proc + P_SIGNAL_MASK) & (1n << word(signal - 1));
  if (signal !== 9 && blocked !== 0n) {
    atomicStoreI32(memory, proc + P_SIGNAL_PENDING, signal);
    return 0;
  }
  atomicStoreI32(memory, proc + P_SIGNAL_LAST, signal);
  return 1;
};

// The reserved request returns the old 64-bit mask and a newly unblocked delivery separately from errno.
const maskSignalsLocked = (memory: ThistleMemory, proc: Ptr, how: I32, input: Ptr): I32 => {
  if (how !== 0 && how !== 1 && how !== 2) return -22;
  if (!inputContains(memory, input, 16)) return -14;
  const pending = loadU32(memory, proc + P_SIGNAL_PENDING);
  if (!validSignal(pending)) return -22;
  const old = atomicLoadU64(memory, proc + P_SIGNAL_MASK), requested = loadU64(memory, input);
  const changed = how === 0 ? old | requested : how === 1 ? old & ~requested : requested;
  const next = changed & ~0x100n;
  atomicStoreU64(memory, proc + P_SIGNAL_MASK, next);
  storeU64(memory, input, old);
  storeU32(memory, input + 8, 0);
  if (pending !== 0 && (next & (1n << word(pending - 1))) === 0n) {
    atomicStoreI32(memory, proc + P_SIGNAL_PENDING, 0);
    atomicStoreI32(memory, proc + P_SIGNAL_LAST, pending);
    storeU32(memory, input + 8, pending);
  }
  return 0;
};

const applyChangeLocked = (memory: ThistleMemory, hart: U32, proc: Ptr, operation: U32, code: I32): I32 => {
  if (operation === 4) return setHostStateLocked(memory, proc, code);
  if (operation === 3) return finishLocked(memory, proc, loadU32(memory, hartAt(hart) + H_PROCESS_SLOT), code);
  if (operation === 2) return runImageLocked(memory, hart, proc);
  return parkLocked(memory, hart, proc, operation);
};

// Lifecycle changes quiesce all bound harts. Signal metadata is serialised by the process lock alone.
const changeLocked = (memory: ThistleMemory, hart: U32, proc: Ptr, operation: U32, code: I32, input: Ptr): I32 => {
  if (operation === 5) return queueSignalLocked(memory, proc, code);
  if (operation === 6) return loadU32(memory, proc + P_STATE) === THISTLE_PROCESS_ZOMBIE
    ? -22 : maskSignalsLocked(memory, proc, code, input);
  if (loadU32(memory, proc + P_LEADER_HART) !== hart ||
      operation !== 3 && loadU32(memory, proc + P_STATE) === THISTLE_PROCESS_ZOMBIE) return -22;
  const slot = loadU32(memory, hartAt(hart) + H_PROCESS_SLOT);
  if (!lockProcessHarts(memory, slot)) return -11;
  const result = applyChangeLocked(memory, hart, proc, operation, code);
  unlockProcessHarts(memory, slot, loadU32(memory, C_MAX_HARTS), INVALID_POINTER);
  return result;
};

const change = (memory: ThistleMemory, hart: U32, operation: U32, code: I32, expectedPid: U32, input: Ptr): I32 => {
  if (!validKernel(memory) || !validHart(memory, hart)) return -22;
  if (compareExchangeI32(memory, C_PROCESS_LOCK, 0, 1) !== 0) return -11;
  const proc = processForHart(memory, hart);
  const result = proc === INVALID_POINTER || expectedPid !== 0 && loadU32(memory, proc + P_PID) !== expectedPid
    ? -3 : changeLocked(memory, hart, proc, operation, code, input);
  atomicStoreI32(memory, C_PROCESS_LOCK, 0);
  return result;
};

/** Trusted host callback parking, with no instruction at address zero to schedule. */
export const thistleProcessPark = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 0, 0, 0, 0);

/** Quiesce every process hart before an embedding replaces its executable image. */
export const thistleProcessPrepareImage = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 1, 0, 0, 0);

/** Publish a fully loaded image as runnable through its existing process leader. */
export const thistleProcessRunImage = (memory: ThistleMemory, hart: U32): I32 => change(memory, hart, 2, 0, 0, 0);

/** Finish every process hart while checking the host view's allocated identity. */
export const thistleProcessFinish = (memory: ThistleMemory, hart: U32, pid: U32, code: I32): I32 =>
  pid === 0 ? -22 : change(memory, hart, 3, code, pid, 0);

/** Host callback phase lives in the canonical process word; hart events retain CPU readiness. */
export const thistleProcessSetHostState = (memory: ThistleMemory, hart: U32, pid: U32, state: I32): I32 =>
  pid === 0 ? -22 : change(memory, hart, 4, state, pid, 0);

/** Queue a supported signal against the canonical process mask; return one when host delivery is needed. */
export const thistleProcessQueueSignal = (memory: ThistleMemory, hart: U32, pid: U32, signal: I32): I32 =>
  pid === 0 ? -22 : change(memory, hart, 5, signal, pid, 0);

/** Replace/block/unblock a mask through a reserved 16-byte request and return any unblocked signal. */
export const thistleProcessSignalMask = (memory: ThistleMemory, hart: U32, pid: U32, how: I32, input: Ptr): I32 =>
  pid === 0 ? -22 : change(memory, hart, 6, how, pid, input);
