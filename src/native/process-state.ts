import {
  C_PROCESS_LOCK, C_CREDENTIAL_LOCK, C_NEXT_PID, P_EUID, P_FSUID, P_FSGID, P_GROUP_COUNT,
  P_GROUPS, P_RGID, P_RUID, P_STATE, P_UMASK, THISTLE_GROUP_CAPACITY,
} from "./abi.js";
import { inputContains } from "./image-range.js";
import {
  atomicStoreI32, compareExchangeI32, copyMemory,
  loadU32, storeU32,
} from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { INVALID_POINTER, processForHart, validHart, validKernel } from "./state.js";
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

const identityBase = (group: boolean): U32 => group ? P_RGID : P_RUID;

const canSetIdentity = (memory: ThistleMemory, proc: Ptr, group: boolean, value: U32): boolean => {
  if (value === KEEP || loadU32(memory, proc + P_EUID) === 0) return true;
  const base = identityBase(group);
  return value === loadU32(memory, proc + base) || value === loadU32(memory, proc + base + 4) ||
    value === loadU32(memory, proc + base + 8);
};

const setResIds = (memory: ThistleMemory, proc: Ptr, group: boolean, real: U32, effective: U32, saved: U32): I32 => {
  if (!canSetIdentity(memory, proc, group, real) || !canSetIdentity(memory, proc, group, effective) ||
      !canSetIdentity(memory, proc, group, saved)) return -1;
  const base = proc + identityBase(group);
  if (real !== KEEP) storeU32(memory, base, real);
  if (effective !== KEEP) storeU32(memory, base + 4, effective);
  if (saved !== KEEP) storeU32(memory, base + 8, saved);
  storeU32(memory, proc + (group ? P_FSGID : P_FSUID), loadU32(memory, base + 4));
  return 0;
};

const setReIds = (memory: ThistleMemory, proc: Ptr, group: boolean, real: U32, effective: U32): I32 => {
  const base = proc + identityBase(group);
  const nextEffective = effective === KEEP ? loadU32(memory, base + 4) : effective;
  const saved = real !== KEEP || effective !== KEEP && effective !== loadU32(memory, base) ? nextEffective : KEEP;
  return setResIds(memory, proc, group, real, effective, saved);
};

const setId = (memory: ThistleMemory, proc: Ptr, group: boolean, value: U32): I32 => {
  if (value === KEEP) return -1;
  const privileged = loadU32(memory, proc + P_EUID) === 0;
  return setResIds(memory, proc, group, privileged ? value : KEEP, value, privileged ? value : KEEP);
};

const setFsId = (memory: ThistleMemory, proc: Ptr, group: boolean, value: U32): I64 => {
  const at = proc + (group ? P_FSGID : P_FSUID);
  const previous = loadU32(memory, at);
  if (validIdentity(value) && value !== KEEP && canSetIdentity(memory, proc, group, value)) storeU32(memory, at, value);
  return word(previous);
};

// Operations pair UID/GID: res=0/1, re=2/3, single=4/5, filesystem=6/7.
// 0xffffffff means unchanged for res/re operations, matching their native ABI.
const updateIdentity = (memory: ThistleMemory, proc: Ptr, operation: U32, first: U32, second: U32, third: U32): I64 => {
  const group = (operation & 1) !== 0;
  if (operation < 2) return word(setResIds(memory, proc, group, first, second, third));
  if (operation < 4) return word(setReIds(memory, proc, group, first, second));
  if (operation < 6) return word(setId(memory, proc, group, first));
  return setFsId(memory, proc, group, first);
};

/** Checked credential changes update the one canonical process record. */
export const thistleProcessIdentity = (memory: ThistleMemory, hart: U32, operation: U32, first: U32, second: U32, third: U32): I64 => {
  if (!validIdentity(operation) || operation > 7) return -22n;
  if (operation < 6 && (!validIdentity(first) || operation < 4 && !validIdentity(second) ||
      operation < 2 && !validIdentity(third))) return -1n;
  const proc = thistleProcessRecord(memory, hart);
  if (proc === INVALID_POINTER) return -3n;
  if (compareExchangeI32(memory, C_CREDENTIAL_LOCK, 0, 1) !== 0) return -11n;
  const result = thistleProcessRecord(memory, hart) === proc
    ? updateIdentity(memory, proc, operation, first, second, third) : -3n;
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return result;
};

const validGroups = (memory: ThistleMemory, input: Ptr, count: U32): boolean => {
  if (!validIdentity(count) || count > THISTLE_GROUP_CAPACITY || !inputContains(memory, input, count * 4)) return false;
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
  copyMemory(memory, proc + P_GROUPS, input, count * 4);
  storeU32(memory, proc + P_GROUP_COUNT, count);
  atomicStoreI32(memory, C_CREDENTIAL_LOCK, 0);
  return 0;
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
