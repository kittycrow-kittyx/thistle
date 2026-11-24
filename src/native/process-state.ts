import { installCredentials, readGroup, replaceGroups, writeGroup, updateIdentity } from "./credentials.js";
import {
  C_MAX_HARTS, C_PROCESS_LOCK, C_CREDENTIAL_LOCK, C_VFS_LOCK, C_NEXT_PID, P_EUID, P_FSUID, P_FSGID, P_GROUP_COUNT, THISTLE_BATCH_CONTENDED, THISTLE_FAULT_BAD_STATE, THISTLE_FAULT_MEMORY,
  H_LOCK, H_PROCESS_SLOT, H_STATUS, THISTLE_HART_RUNNABLE, THISTLE_PROCESS_RUNNABLE, THISTLE_PROCESS_WAITING, THISTLE_PROCESS_RUNNING,
  P_RGID, P_RUID, P_STATE, P_UMASK,
} from "./abi.js";
import { inputContains } from "./arena.js";
import {
  atomicStoreI32, compareExchangeI32,
  loadU32, storeU32,
} from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { lockProcessHarts, unlockProcessHarts, bindProcess, hartAt, processAt, processSlotByPid, INVALID_POINTER, processForHart, validHart, validKernel } from "./state.js";
import type { I32, I64, Ptr, U32 } from "./types.js";
import { floatFloor, word, wordToI32 } from "./word.js";

const KEEP: U32 = 0xffffffff;

/** A host can read the canonical record without creating another process model. */
export const thistleProcessRecord = (memory: ThistleMemory, hart: U32): Ptr => {
  if (!validHart(memory, hart)) return INVALID_POINTER;
  const proc = processForHart(memory, hart);
  return proc === INVALID_POINTER || loadU32(memory, proc + P_STATE) === 0 ? INVALID_POINTER : proc;
};

/** Allocate PID identity from the same counter used by native process creation. */
export const thistleNextPid = (memory: ThistleMemory): U32 => {
  if (!validKernel(memory) || compareExchangeI32(memory, C_PROCESS_LOCK, 0, 1) !== 0) return 0;
  const pid = loadU32(memory, C_NEXT_PID);
  if (pid >= 2 && pid < KEEP) storeU32(memory, C_NEXT_PID, pid + 1);
  atomicStoreI32(memory, C_PROCESS_LOCK, 0);
  return pid >= 2 && pid < KEEP ? pid : 0;
};

const validIdentity = (value: U32): boolean => value >= 0 && value <= KEEP && floatFloor(value) === value;

/** Checked credential changes update the one canonical process record. */
export const thistleProcessIdentity = (memory: ThistleMemory, hart: U32, operation: U32, first: U32, second: U32, third: U32): I64 => {
  if (!validIdentity(operation) || operation > 7) return -22n;
  if (operation < 6 && (!validIdentity(first) || operation < 4 && !validIdentity(second) ||
      operation < 2 && !validIdentity(third))) return -1n;
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER) return -3n;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11n;
  if (compareExchangeI32(memory, C_VFS_LOCK, 0, 1) !== 0) {
    atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -11n;
  }
  const result = thistleProcessRecord(memory, hart) === proc
    ? updateIdentity(memory, proc, operation, first, second, third) : -3n;
  atomicStoreI32(memory, C_VFS_LOCK, 0);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return result;
};

const validGroups = (memory: ThistleMemory, input: Ptr, count: U32): boolean => {
  if (!validIdentity(count) || count > 0x3fffffff || !inputContains(memory, input, count * 4)) return false;
  let index: U32 = 0;
  while (index < count) {
    if (loadU32(memory, input + index * 4) === KEEP) return false;
    index += 1;
  }
  return true;
};

/** Replace supplementary groups atomically after validating all input IDs. */
export const thistleProcessGroups = (memory: ThistleMemory, hart: U32, input: Ptr, count: U32): I32 => {
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11;
  if (thistleProcessRecord(memory, hart) !== proc || loadU32(memory, proc + P_EUID) !== 0) {
    atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -1;
  }
  if (!validGroups(memory, input, count)) {
    atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -22;
  }
  const result = replaceGroups(memory, proc, input, count);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return result;
};

/** Change umask in canonical state and return its previous value. */
export const thistleProcessUmask = (memory: ThistleMemory, hart: U32, mask: U32): I32 => {
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11;
  if (thistleProcessRecord(memory, hart) !== proc) {
    atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0); return -3;
  }
  const old = loadU32(memory, proc + P_UMASK);
  storeU32(memory, proc + P_UMASK, mask & 0o777);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return wordToI32(word(old));
};

/** Trusted initialisation retains the positive-status native ABI. */
export const thistleProcessSetGroup = (memory: ThistleMemory, hart: U32, index: U32, gid: U32): I32 => {
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER || !validIdentity(index) || !validIdentity(gid) || gid === KEEP) return THISTLE_FAULT_BAD_STATE;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return THISTLE_BATCH_CONTENDED;
  const result = writeGroup(memory, proc, index, gid);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  if (result === -11) return THISTLE_BATCH_CONTENDED;
  if (result === -12) return THISTLE_FAULT_MEMORY;
  return result === 0 ? 0 : THISTLE_FAULT_BAD_STATE;
};

const copyGroups = (memory: ThistleMemory, proc: Ptr, output: Ptr, capacity: U32): I32 => {
  const count = loadU32(memory, proc + P_GROUP_COUNT);
  if (capacity === 0) return wordToI32(word(count));
  if (capacity < count) return -34;
  if (count > 0x3fffffff || !inputContains(memory, output, count * 4)) return -14;
  let index: U32 = 0;
  while (index < count) {
    storeU32(memory, output + index * 4, readGroup(memory, proc, index));
    index += 1;
  }
  return wordToI32(word(count));
};

/** Capacity zero queries count; otherwise copy a coherent reserved-buffer snapshot. */
export const thistleProcessReadGroups = (memory: ThistleMemory, hart: U32, output: Ptr, capacity: U32): I32 => {
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER || !validIdentity(capacity)) return -22;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11;
  const result = copyGroups(memory, proc, output, capacity);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return result;
};

const attachBoundLocked = (memory: ThistleMemory, hart: U32, slot: U32): I32 => {
  const proc = processAt(memory, slot), at = hartAt(hart);
  const state = loadU32(memory, proc + P_STATE);
  if (state !== THISTLE_PROCESS_RUNNABLE && state !== THISTLE_PROCESS_WAITING && state !== THISTLE_PROCESS_RUNNING) return -3;
  if (loadU32(memory, at + H_PROCESS_SLOT) !== INVALID_POINTER) return -16;
  if (loadU32(memory, at + H_STATUS) !== THISTLE_HART_RUNNABLE) return -22;
  bindProcess(memory, hart, slot);
  storeU32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  return 0;
};

const attachLocked = (memory: ThistleMemory, hart: U32, pid: U32): I32 => {
  if (loadU32(memory, hartAt(hart) + H_STATUS) !== THISTLE_HART_RUNNABLE) return -22;
  if (loadU32(memory, hartAt(hart) + H_PROCESS_SLOT) !== INVALID_POINTER) return -16;
  const slot = processSlotByPid(memory, pid);
  if (slot === INVALID_POINTER) return -3;
  if (!lockProcessHarts(memory, slot)) return -11;
  const result = attachBoundLocked(memory, hart, slot);
  unlockProcessHarts(memory, slot, loadU32(memory, C_MAX_HARTS), hart);
  return result;
};

/** Attach a fresh hart to existing process state, without a second process record. */
export const thistleProcessAttach = (memory: ThistleMemory, hart: U32, pid: U32): I32 => {
  if (!validKernel(memory) || !validHart(memory, hart)) return -22;
  if (compareExchangeI32(memory, C_PROCESS_LOCK, 0, 1) !== 0) return -11;
  const at = hartAt(hart);
  if (compareExchangeI32(memory, at + H_LOCK, 0, 1) !== 0) {
    atomicStoreI32(memory, C_PROCESS_LOCK, 0); return -11;
  }
  const result = attachLocked(memory, hart, pid);
  atomicStoreI32(memory, at + H_LOCK, 0);
  atomicStoreI32(memory, C_PROCESS_LOCK, 0);
  return result;
};

const validCredentialInput = (memory: ThistleMemory, input: Ptr): boolean => {
  if (!inputContains(memory, input, 36)) return false;
  let field: U32 = 0;
  while (field < 32) {
    if (loadU32(memory, input + field) === KEEP) return false;
    field += 4;
  }
  return validGroups(memory, input + 36, loadU32(memory, input + 32));
};

/** Trusted embedding/exec loader, not a guest privilege-changing syscall. */
export const thistleProcessInstallCredentials = (memory: ThistleMemory, hart: U32, input: Ptr): I32 => {
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11;
  let result: I32 = -3;
  if (thistleProcessRecord(memory, hart) === proc) result = validCredentialInput(memory, input)
    ? installCredentials(memory, proc, input) : -22;
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return result;
};
