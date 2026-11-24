import {
  C_MEMORY_LOCK, C_VFS_LOCK, P_EUID, P_RGID, P_RUID, P_FSUID, P_FSGID,
  P_GROUP_COUNT, P_GROUP_DATA, P_GROUPS, THISTLE_GROUP_CAPACITY, THISTLE_GUEST_PAGE_SIZE,
} from "./abi.js";
import { allocateFrame, releaseFrame, trimFreeFrames } from "./arena.js";
import { atomicStoreI32, compareExchangeI32, copyMemory, loadU32, storeU32 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import { word, wordToI32, wordToPtr, floatFloor } from "./word.js";
import type { I32, I64, Ptr, U32 } from "./types.js";

const INVALID: Ptr = 0xffffffff;
const PER_FRAME: U32 = (THISTLE_GUEST_PAGE_SIZE - 4) / 4;

/** Read an inline or extended ID while the caller holds a credential/VFS lock. */
export const readGroup = (memory: ThistleMemory, proc: Ptr, index: U32): U32 => {
  if (index >= loadU32(memory, proc + P_GROUP_COUNT)) return INVALID;
  if (index < THISTLE_GROUP_CAPACITY) return loadU32(memory, proc + P_GROUPS + index * 4);
  let offset = index - THISTLE_GROUP_CAPACITY;
  let frame = loadU32(memory, proc + P_GROUP_DATA);
  while (frame !== 0 && offset >= PER_FRAME) {
    offset -= PER_FRAME;
    frame = loadU32(memory, frame);
  }
  return frame === 0 ? INVALID : loadU32(memory, frame + 4 + offset * 4);
};

const releaseChain = (memory: ThistleMemory, head: Ptr): void => {
  let frame = head;
  while (frame !== 0) {
    const next = loadU32(memory, frame);
    releaseFrame(memory, frame);
    frame = next;
  }
};

// A replacement chain is private until every allocation and copy succeeds.
const allocateChain = (memory: ThistleMemory, input: Ptr, count: U32): Ptr => {
  let remaining = count, at = input;
  let head: Ptr = 0, previous: Ptr = 0;
  while (remaining !== 0) {
    const frame = allocateFrame(memory);
    if (frame === INVALID) { releaseChain(memory, head); trimFreeFrames(memory); return INVALID; }
    const amount = remaining < PER_FRAME ? remaining : PER_FRAME;
    copyMemory(memory, frame + 4, at, amount * 4);
    if (head === 0) head = frame;
    if (previous !== 0) storeU32(memory, previous, frame);
    previous = frame;
    at += amount * 4;
    remaining -= amount;
  }
  return head;
};

const replaceLocked = (memory: ThistleMemory, proc: Ptr, input: Ptr, count: U32): I32 => {
  const inline = count < THISTLE_GROUP_CAPACITY ? count : THISTLE_GROUP_CAPACITY;
  const chain = allocateChain(memory, input + inline * 4, count - inline);
  if (chain === INVALID) return -12;
  const old = loadU32(memory, proc + P_GROUP_DATA);
  copyMemory(memory, proc + P_GROUPS, input, inline * 4);
  storeU32(memory, proc + P_GROUP_DATA, chain);
  storeU32(memory, proc + P_GROUP_COUNT, count);
  releaseChain(memory, old);
  trimFreeFrames(memory);
  return 0;
};

const extendedEntry = (memory: ThistleMemory, proc: Ptr, index: U32): I64 => {
  let offset = index - THISTLE_GROUP_CAPACITY;
  let link = proc + P_GROUP_DATA;
  while (offset >= PER_FRAME) {
    const frame = loadU32(memory, link);
    if (frame === 0) return -22n;
    link = frame; offset -= PER_FRAME;
  }
  const existing = loadU32(memory, link);
  if (existing !== 0) return word(existing + 4 + offset * 4);
  const frame = allocateFrame(memory);
  if (frame === INVALID) return -12n;
  storeU32(memory, link, frame);
  return word(frame + 4 + offset * 4);
};

const writeLocked = (memory: ThistleMemory, proc: Ptr, index: U32, gid: U32): I32 => {
  const count = loadU32(memory, proc + P_GROUP_COUNT);
  if (index > count || gid === INVALID) return -22;
  const entry = index >= THISTLE_GROUP_CAPACITY
    ? extendedEntry(memory, proc, index) : word(proc + P_GROUPS + index * 4);
  if (entry < 0n) return wordToI32(entry);
  storeU32(memory, wordToPtr(entry), gid);
  if (index === count) storeU32(memory, proc + P_GROUP_COUNT, count + 1);
  return 0;
};

const installLocked = (memory: ThistleMemory, proc: Ptr, input: Ptr): I32 => {
  const count = loadU32(memory, input + 32);
  const result = replaceLocked(memory, proc, input + 36, count);
  if (result !== 0) return result;
  let field: U32 = 0;
  while (field < 32) {
    storeIdentity(memory, proc + P_RUID + field, loadU32(memory, input + field));
    field += 4;
  }
  return 0;
};

// Memory/VFS locks cover allocation and publication of both groups and loader IDs.
// Failed allocation leaves the live record untouched.
const updateGroups = (memory: ThistleMemory, proc: Ptr, input: Ptr, count: U32, gid: U32, operation: U32): I32 => {
  if (compareExchangeI32(memory, C_MEMORY_LOCK, 0, 1) !== 0) return -11;
  if (compareExchangeI32(memory, C_VFS_LOCK, 0, 1) !== 0) {
    atomicStoreI32(memory, C_MEMORY_LOCK, 0); return -11;
  }
  const result = operation === 0 ? writeLocked(memory, proc, count, gid) : operation === 1
    ? replaceLocked(memory, proc, input, count) : installLocked(memory, proc, input);
  atomicStoreI32(memory, C_VFS_LOCK, 0); atomicStoreI32(memory, C_MEMORY_LOCK, 0);
  return result;
};

/** Caller holds the credential lock; memory and VFS locks protect publication. */
export const replaceGroups = (memory: ThistleMemory, proc: Ptr, input: Ptr, count: U32): I32 =>
  updateGroups(memory, proc, input, count, 0, 1);

/** Initialise or replace one group in canonical state. */
export const writeGroup = (memory: ThistleMemory, proc: Ptr, index: U32, gid: U32): I32 =>
  updateGroups(memory, proc, 0, index, gid, 0);

/** Caller holds credential, memory and VFS locks. */
export const releaseGroups = (memory: ThistleMemory, proc: Ptr): void => {
  const old = loadU32(memory, proc + P_GROUP_DATA);
  storeU32(memory, proc + P_GROUP_DATA, 0);
  storeU32(memory, proc + P_GROUP_COUNT, 0);
  releaseChain(memory, old);
};

const KEEP: U32 = 0xffffffff;
const validIdentity = (value: U32): boolean => value >= 0 && value <= KEEP && floatFloor(value) === value;

// Lockless get-ID syscalls read these words atomically.
const storeIdentity = (memory: ThistleMemory, at: Ptr, value: U32): void =>
  atomicStoreI32(memory, at, wordToI32(word(value)));

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
  if (real !== KEEP) storeIdentity(memory, base, real);
  if (effective !== KEEP) storeIdentity(memory, base + 4, effective);
  if (saved !== KEEP) storeIdentity(memory, base + 8, saved);
  storeIdentity(memory, proc + (group ? P_FSGID : P_FSUID), loadU32(memory, base + 4));
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
  if (validIdentity(value) && value !== KEEP && canSetIdentity(memory, proc, group, value)) storeIdentity(memory, at, value);
  return word(previous);
};

// Operations pair UID/GID: res=0/1, re=2/3, single=4/5, filesystem=6/7.
// 0xffffffff means unchanged for res/re operations, matching their native ABI.
export const updateIdentity = (memory: ThistleMemory, proc: Ptr, operation: U32, first: U32, second: U32, third: U32): I64 => {
  const group = (operation & 1) !== 0;
  if (operation < 2) return word(setResIds(memory, proc, group, first, second, third));
  if (operation < 4) return word(setReIds(memory, proc, group, first, second));
  if (operation < 6) return word(setId(memory, proc, group, first));
  return setFsId(memory, proc, group, first);
};


/** Trusted loader batch; input validated by the ABI wrapper, caller holds credential lock. */
export const installCredentials = (memory: ThistleMemory, proc: Ptr, input: Ptr): I32 =>
  updateGroups(memory, proc, input, 0, 0, 2);
