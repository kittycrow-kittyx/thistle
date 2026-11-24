import { readGroup } from "./credentials.js";
import { inputContains } from "./arena.js";
import {
  C_PROCESS_CAPACITY,
  FD_INODE, FD_KIND, FD_FLAGS, FD_IDENTITY, FD_OFFSET, THISTLE_FD_EMPTY, THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_FD_APPEND, THISTLE_FD_CLOEXEC, THISTLE_FD_FILE, THISTLE_FD_DIRECTORY, P_DESCRIPTOR_CAPACITY, P_DESCRIPTOR_TABLE, THISTLE_DESCRIPTOR_STRIDE,
  C_PROCESS_TABLE_BASE,
  C_VFS_DATA_BASE,
  C_VFS_DATA_END,
  C_VFS_DATA_NEXT,
  C_VFS_DENTRY_BASE,
  C_VFS_DENTRY_CAPACITY,
  C_VFS_DENTRY_COUNT,
  C_VFS_DIRTY,
  C_VFS_GENERATION,
  C_VFS_INODE_BASE,
  C_VFS_INODE_CAPACITY,
  C_VFS_INODE_COUNT,
  C_VFS_LOADED,
  C_VFS_ROOT,
  C_VFS_SCRATCH_BASE,
  THISTLE_VFS_PATH_CAPACITY,
  D_FLAGS,
  D_INODE,
  D_NAME,
  D_NAME_HASH,
  D_NAME_LENGTH,
  D_PARENT,
  THISTLE_CONTROL_BASE,
  THISTLE_VFS_CAPACITY_ERROR,
  THISTLE_VFS_CHECKSUM, THISTLE_VFS_BUSY,
  THISTLE_VFS_DENTRY_STRIDE,
  THISTLE_VFS_DUPLICATE,
  THISTLE_VFS_FORMAT,
  THISTLE_VFS_IMAGE_MAGIC,
  THISTLE_VFS_IMAGE_VERSION,
  THISTLE_VFS_INODE_STRIDE,
  THISTLE_VFS_KIND_DIRECTORY,
  THISTLE_VFS_KIND_EMPTY,
  THISTLE_VFS_KIND_FILE,
  THISTLE_VFS_KIND_LINK,
  THISTLE_VFS_OK,
  THISTLE_VFS_RANGE,
  P_FSGID,
  P_FSUID,
  P_CWD_INODE,
  P_GROUP_COUNT,
  P_STATE,
  THISTLE_PROCESS_EMPTY,
  THISTLE_PROCESS_STRIDE,
  V_ATIME,
  V_CAPACITY,
  V_CTIME,
  V_DATA,
  V_FLAGS, V_RESIDENT, V_VERSION, V_IDENTITY, C_VFS_QUOTA, THISTLE_VFS_HOST_BACKING,
  V_GID,
  V_KIND,
  V_MODE,
  V_MTIME,
  V_NLINK,
  V_SIZE,
  V_UID,
} from "./abi.js";
import {
  atomicLoadU64,
  atomicStoreU64,
  copyMemory,
  fill,
  loadU8,
  loadU32,
  loadU64,
  memorySize as memorySizeOf,
  storeU8,
  storeU32,
  storeU64,
} from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, I64, Ptr, U32, U64 } from "./types.js";
import { mulU32, sx, ux, word, wordToI32, wordToU32 } from "./word.js";

const VFS_HEADER_SIZE: U32 = 32;
const VFS_INODE_IMAGE_SIZE: U32 = 56;
const VFS_DENTRY_IMAGE_SIZE: U32 = 16;


const memoryContains = (memory: ThistleMemory, at: Ptr, size: U32): boolean => {
  const total = memorySizeOf(memory);
  return at <= total && size <= total - at;
};

export const inodeAt = (memory: ThistleMemory, inode: U32): Ptr =>
  loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_BASE) + inode * THISTLE_VFS_INODE_STRIDE;

export const dentryAt = (memory: ThistleMemory, index: U32): Ptr =>
  loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_BASE) + index * THISTLE_VFS_DENTRY_STRIDE;

/** Locate an already validated descriptor slot in a canonical process record. */
export const descriptorAt = (memory: ThistleMemory, proc: Ptr, descriptor: U32): Ptr =>
  loadU32(memory, proc + P_DESCRIPTOR_TABLE) + descriptor * THISTLE_DESCRIPTOR_STRIDE;

/** Caller owns descriptor and VFS locks; release an inode after clearing its reference. */
export const releaseDescriptor = (memory: ThistleMemory, state: Ptr): void => {
  const inode = loadU32(memory, state + FD_INODE), identity = loadU32(memory, state + FD_IDENTITY);
  fill(memory, state, THISTLE_DESCRIPTOR_STRIDE, 0);
  storeU32(memory, state + FD_IDENTITY, identity);
  thistleVfsRelease(memory, inode);
};

/** Return the first reusable slot at or above minimum, under the descriptor lock. */
export const freeDescriptor = (memory: ThistleMemory, proc: Ptr, minimum: U32): I32 => {
  const capacity = loadU32(memory, proc + P_DESCRIPTOR_CAPACITY);
  let descriptor = minimum;
  while (descriptor < capacity) {
    const state = descriptorAt(memory, proc, descriptor);
    if (loadU32(memory, state + FD_KIND) === THISTLE_FD_EMPTY && loadU32(memory, state + FD_IDENTITY) !== 0xffffffff) return wordToI32(word(descriptor));
    descriptor += 1;
  }
  return -24;
};

/** Install a descriptor incarnation. Caller holds descriptor/VFS locks or owns a new process. */
export const installDescriptor = (memory: ThistleMemory, state: Ptr, kind: U32, flags: U32, inode: U32): I32 => {
  const previous = loadU32(memory, state + FD_IDENTITY);
  if (previous === 0xffffffff) return -23;
  if (loadU32(memory, state + FD_KIND) !== THISTLE_FD_EMPTY) releaseDescriptor(memory, state);
  storeU32(memory, state + FD_IDENTITY, previous + 1);
  storeU32(memory, state + FD_KIND, kind);
  storeU32(memory, state + FD_FLAGS, flags);
  storeU32(memory, state + FD_INODE, inode);
  return 0;
};

const align4 = (value: U32): U32 => (value + 3) & -4;

export const hashBytes = (memory: ThistleMemory, at: Ptr, size: U32): U32 => {
  let hash: U32 = 0x811c9dc5;
  let index: U32 = 0;
  while (index < size) {
    hash = mulU32(hash ^ loadU8(memory, at + index), 0x01000193);
    index += 1;
  }
  return hash;
};

// The arena first extends its high-water mark, then reuses gaps left by
// replaced payloads and removed entries. Live inode/entry references remain
// the sole allocation authority, so an open unlinked file keeps its bytes.
const nextPayloadEnd = (memory: ThistleMemory, at: Ptr, size: U32, excluded: Ptr): Ptr => {
  let next = at;
  const inodeCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY);
  let index: U32 = 1;
  while (index < inodeCapacity) {
    const state = inodeAt(memory, index);
    const start = loadU32(memory, state + V_DATA);
    const length = loadU32(memory, state + V_CAPACITY);
    if (state !== excluded && loadU32(memory, state + V_KIND) !== 0 && length !== 0 && at < start + length && start < at + size) {
      const end = align4(start + length);
      next = end > next ? end : next;
    }
    index += 1;
  }
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  index = 0;
  while (index < count) {
    const entry = dentryAt(memory, index);
    const start = loadU32(memory, entry + D_NAME);
    const length = loadU32(memory, entry + D_NAME_LENGTH);
    if (loadU32(memory, entry + D_INODE) !== 0 && length !== 0 && at < start + length && start < at + size) {
      const end = align4(start + length);
      next = end > next ? end : next;
    }
    index += 1;
  }
  return next;
};

export const allocateData = (memory: ThistleMemory, size: U32): Ptr => {
  if (size === 0) return 0;
  const aligned = align4(size);
  if (aligned < size) return 0xffffffff;
  const next = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_NEXT);
  const end = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_END);
  if (next <= end && aligned <= end - next) {
    storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_NEXT, next + aligned);
    return next;
  }
  let at = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_BASE);
  while (at <= end && aligned <= end - at) {
    const free = nextPayloadEnd(memory, at, aligned, 0);
    if (free === at) return at;
    at = free;
  }
  return 0xffffffff;
};

// Extend a payload in place when its following arena range is free. This
// avoids requiring room for two copies when a file grows near the VFS budget.
export const growData = (memory: ThistleMemory, inode: U32, size: U32): Ptr => {
  const state = inodeAt(memory, inode);
  const at = loadU32(memory, state + V_DATA);
  const base = loadU32(memory, C_VFS_DATA_BASE);
  const end = loadU32(memory, C_VFS_DATA_END);
  const aligned = align4(size);
  if (at < base || aligned < size || at > end || aligned > end - at) return allocateData(memory, size);
  if (nextPayloadEnd(memory, at, aligned, state) !== at) return allocateData(memory, size);
  const next = at + aligned;
  if (next > loadU32(memory, C_VFS_DATA_NEXT)) storeU32(memory, C_VFS_DATA_NEXT, next);
  return at;
};

export const validName = (memory: ThistleMemory, at: Ptr, size: U32): boolean => {
  if (size === 0 || size > 255) return false;
  let index: U32 = 0;
  while (index < size) {
    const value = loadU8(memory, at + index);
    if (value === 0 || value === 47) return false;
    index += 1;
  }
  if (size === 1 && loadU8(memory, at) === 46) return false;
  if (size === 2 && loadU8(memory, at) === 46 && loadU8(memory, at + 1) === 46) return false;
  return true;
};

export const sameName = (memory: ThistleMemory, dentry: Ptr, at: Ptr, size: U32, hash: U32): boolean => {
  if (loadU32(memory, dentry + D_NAME_LENGTH) !== size || loadU32(memory, dentry + D_NAME_HASH) !== hash) return false;
  const stored = loadU32(memory, dentry + D_NAME);
  let index: U32 = 0;
  while (index < size) {
    if (loadU8(memory, stored + index) !== loadU8(memory, at + index)) return false;
    index += 1;
  }
  return true;
};

export const findChild = (memory: ThistleMemory, parent: U32, name: Ptr, nameLength: U32): U32 => {
  if (!validName(memory, name, nameLength)) return 0;
  const hash = hashBytes(memory, name, nameLength);
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const dentry = dentryAt(memory, index);
    if (loadU32(memory, dentry + D_PARENT) === parent && sameName(memory, dentry, name, nameLength, hash)) {
      return loadU32(memory, dentry + D_INODE);
    }
    index += 1;
  }
  return 0;
};

const entryForInode = (memory: ThistleMemory, inode: U32): Ptr => {
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const dentry = dentryAt(memory, index);
    if (loadU32(memory, dentry + D_INODE) === inode) return dentry;
    index += 1;
  }
  return 0;
};

export const parentOf = (memory: ThistleMemory, inode: U32): U32 => {
  const root = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT);
  if (inode === root) return root;
  const entry = entryForInode(memory, inode);
  return entry === 0 ? 0 : loadU32(memory, entry + D_PARENT);
};

const inSupplementaryGroup = (memory: ThistleMemory, proc: Ptr, gid: U32): boolean => {
  const count = loadU32(memory, proc + P_GROUP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    if (readGroup(memory, proc, index) === gid) return true;
    index += 1;
  }
  return false;
};

export const allowed = (memory: ThistleMemory, proc: Ptr, inode: U32, bits: U32): boolean => {
  const state = inodeAt(memory, inode);
  const uid = loadU32(memory, proc + P_FSUID);
  if (uid === 0) return true;
  const owner = loadU32(memory, state + V_UID);
  const group = loadU32(memory, state + V_GID);
  const gid = loadU32(memory, proc + P_FSGID);
  const shift: U32 = uid === owner ? 6 : gid === group || inSupplementaryGroup(memory, proc, group) ? 3 : 0;
  return ((loadU32(memory, state + V_MODE) >>> shift) & bits) === bits;
};

const moreComponents = (memory: ThistleMemory, at: Ptr, end: Ptr): boolean => {
  let cursor = at;
  while (cursor < end) {
    if (loadU8(memory, cursor) !== 47) return true;
    cursor += 1;
  }
  return false;
};

const resolveLink = (memory: ThistleMemory, proc: Ptr, current: U32, child: U32, hops: U32): I32 => {
  const link = inodeAt(memory, child);
  const target = loadU32(memory, link + V_DATA);
  const targetLength = wordToU32(loadU64(memory, link + V_SIZE));
  if (targetLength === 0 || targetLength > 4096) return -2;
  const root = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT);
  const base = loadU8(memory, target) === 47 ? root : current;
  return resolveRange(memory, proc, base, target, targetLength, ((hops + 1) << 1) | 1);
};

const resolveRange = (
  memory: ThistleMemory,
  proc: Ptr,
  start: U32,
  path: Ptr,
  pathLength: U32,
  traversal: U32,
): I32 => {
  // Bit zero controls final symlink following; upper bits carry the traversal depth.
  const followFinal = (traversal & 1) !== 0;
  const hops = traversal >>> 1;
  if (hops > 32) return -40;
  const root = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT);
  const end = path + pathLength;
  let cursor = path;
  let current = pathLength !== 0 && loadU8(memory, path) === 47 ? root : start;
  if (current === 0 || thistleVfsKind(memory, current) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (pathLength === 0) return -2;
  while (cursor < end) {
    while (cursor < end && loadU8(memory, cursor) === 47) cursor += 1;
    if (cursor === end) break;
    const component = cursor;
    while (cursor < end && loadU8(memory, cursor) !== 47) cursor += 1;
    const length = cursor - component;
    if (length > 255) return -36;
    const final = !moreComponents(memory, cursor, end);
    if (thistleVfsKind(memory, current) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
    if (!allowed(memory, proc, current, 1)) return -13;
    if (length === 1 && loadU8(memory, component) === 46) continue;
    const dotdot = length === 2 && loadU8(memory, component) === 46 && loadU8(memory, component + 1) === 46;
    const parent = dotdot ? parentOf(memory, current) : current;
    if (dotdot && parent === 0) return -2;
    if (dotdot) { current = parent; continue; }
    const child = findChild(memory, current, component, length);
    if (child === 0) return -2;
    const follow = thistleVfsKind(memory, child) === THISTLE_VFS_KIND_LINK && (!final || followFinal || cursor < end);
    const resolved = follow ? resolveLink(memory, proc, current, child, hops) : wordToI32(word(child));
    if (resolved < 0) return resolved;
    current = wordToU32(word(resolved));
  }
  if (pathLength !== 0 && loadU8(memory, end - 1) === 47 && thistleVfsKind(memory, current) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  return wordToI32(word(current));
};

export const thistleVfsLoaded = (memory: ThistleMemory): boolean =>
  loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_LOADED) === 1;

export const thistleVfsRoot = (memory: ThistleMemory): U32 =>
  thistleVfsLoaded(memory) ? loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT) : 0;

export const thistleVfsInodeCount = (memory: ThistleMemory): U32 =>
  thistleVfsLoaded(memory) ? loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT) : 0;

export const thistleVfsDentryCount = (memory: ThistleMemory): U32 =>
  thistleVfsLoaded(memory) ? loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT) : 0;

export const thistleVfsKind = (memory: ThistleMemory, inode: U32): U32 => {
  if (!thistleVfsLoaded(memory) || inode === 0 || inode >= loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY)) return 0;
  return loadU32(memory, inodeAt(memory, inode) + V_KIND);
};

/** Inode incarnation stays fixed across edits and changes on slot reuse or remount. */
export const thistleVfsIdentity = (memory: ThistleMemory, inode: U32): U64 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0n : loadU64(memory, inodeAt(memory, inode) + V_IDENTITY);

export const thistleVfsFileSize = (memory: ThistleMemory, inode: U32): U64 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0n : loadU64(memory, inodeAt(memory, inode) + V_SIZE);

export const thistleVfsMode = (memory: ThistleMemory, inode: U32): U32 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0 : loadU32(memory, inodeAt(memory, inode) + V_MODE);

export const thistleVfsUid = (memory: ThistleMemory, inode: U32): U32 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0 : loadU32(memory, inodeAt(memory, inode) + V_UID);

export const thistleVfsGid = (memory: ThistleMemory, inode: U32): U32 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0 : loadU32(memory, inodeAt(memory, inode) + V_GID);

export const thistleVfsNlink = (memory: ThistleMemory, inode: U32): U32 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_EMPTY ? 0 : loadU32(memory, inodeAt(memory, inode) + V_NLINK);

export const thistleVfsLookup = (memory: ThistleMemory, parent: U32, name: Ptr, nameLength: U32): U32 => {
  if (!thistleVfsLoaded(memory) || !inputContains(memory, name, nameLength) || !validName(memory, name, nameLength) ||
      thistleVfsKind(memory, parent) !== THISTLE_VFS_KIND_DIRECTORY) return 0;
  return findChild(memory, parent, name, nameLength);
};

export const thistleVfsResolve = (
  memory: ThistleMemory,
  proc: Ptr,
  start: U32,
  path: Ptr,
  pathLength: U32,
  followFinal: boolean,
): I32 => {
  if (!thistleVfsLoaded(memory) || pathLength > 4096 || !memoryContains(memory, path, pathLength)) return -22;
  return resolveRange(memory, proc, start, path, pathLength, followFinal ? 1 : 0);
};

export const thistleVfsAccess = (memory: ThistleMemory, proc: Ptr, inode: U32, bits: U32): boolean =>
  thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_EMPTY && bits <= 7 && allowed(memory, proc, inode, bits);

/** Open a canonical inode under the process descriptor, credential and VFS locks. */
export const thistleVfsOpenInode = (memory: ThistleMemory, proc: Ptr, inode: U32, flags: U32, minimum: U32): I32 => {
  if ((flags & ~(THISTLE_FD_READ | THISTLE_FD_WRITE | THISTLE_FD_APPEND | THISTLE_FD_CLOEXEC)) !== 0 ||
      (flags & (THISTLE_FD_READ | THISTLE_FD_WRITE)) === 0 ||
      ((flags & THISTLE_FD_APPEND) !== 0 && (flags & THISTLE_FD_WRITE) === 0)) return -22;
  const kind = thistleVfsKind(memory, inode);
  if (kind === THISTLE_VFS_KIND_EMPTY) return -2;
  if (kind !== THISTLE_VFS_KIND_DIRECTORY && kind !== THISTLE_VFS_KIND_FILE) return -22;
  if (kind === THISTLE_VFS_KIND_DIRECTORY && (flags & THISTLE_FD_WRITE) !== 0) return -21;
  const bits: U32 = kind === THISTLE_VFS_KIND_DIRECTORY ? 5 :
    ((flags & THISTLE_FD_READ) !== 0 ? 4 : 0) | ((flags & THISTLE_FD_WRITE) !== 0 ? 2 : 0);
  if (!allowed(memory, proc, inode, bits)) return -13;
  const descriptor = freeDescriptor(memory, proc, minimum);
  if (descriptor < 0) return descriptor;
  const state = descriptorAt(memory, proc, wordToU32(word(descriptor)));
  const result = installDescriptor(memory, state, kind === THISTLE_VFS_KIND_DIRECTORY ? THISTLE_FD_DIRECTORY : THISTLE_FD_FILE, flags, inode);
  if (result !== 0) return result;
  if ((flags & THISTLE_FD_APPEND) !== 0) storeU64(memory, state + FD_OFFSET, thistleVfsFileSize(memory, inode));
  return descriptor;
};

/** Change cwd using the same traversal and search policy as native open. Caller holds VFS lock. */
export const thistleVfsChdir = (memory: ThistleMemory, proc: Ptr, path: Ptr, length: U32): I32 => {
  const result = thistleVfsResolve(memory, proc, loadU32(memory, proc + P_CWD_INODE), path, length, true);
  if (result < 0) return result;
  const inode = wordToU32(word(result));
  if (thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (!allowed(memory, proc, inode, 1)) return -13;
  storeU32(memory, proc + P_CWD_INODE, inode);
  return 0;
};

/** A directory used as cwd must not be deleted or replaced. Caller holds VFS lock. */
export const thistleVfsCwdHeld = (memory: ThistleMemory, inode: U32): boolean => {
  const base = loadU32(memory, C_PROCESS_TABLE_BASE), count = loadU32(memory, C_PROCESS_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const proc = base + index * THISTLE_PROCESS_STRIDE;
    if (loadU32(memory, proc + P_STATE) !== 0 && loadU32(memory, proc + P_CWD_INODE) === inode) return true;
    index += 1;
  }
  return false;
};

/** Write the current canonical directory path, including NUL, into a reserved image. */
export const thistleVfsCwdPath = (memory: ThistleMemory, proc: Ptr, output: Ptr, capacity: U32): I32 => {
  if (capacity < 2 || !inputContains(memory, output, capacity)) return -34;
  const root = thistleVfsRoot(memory);
  let inode = loadU32(memory, proc + P_CWD_INODE);
  if (root === 0 || thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_DIRECTORY) return -2;
  let cursor = capacity - 1;
  storeU8(memory, output + cursor, 0);
  let remaining = loadU32(memory, C_VFS_INODE_CAPACITY);
  while (inode !== root && remaining !== 0) {
    const entry = entryForInode(memory, inode);
    if (entry === 0) return -2;
    const length = loadU32(memory, entry + D_NAME_LENGTH);
    if (length >= cursor) return -34;
    cursor -= length;
    copyMemory(memory, output + cursor, loadU32(memory, entry + D_NAME), length);
    cursor -= 1;
    storeU8(memory, output + cursor, 47);
    inode = loadU32(memory, entry + D_PARENT);
    remaining -= 1;
  }
  if (inode !== root) return -40;
  if (cursor === capacity - 1) { cursor -= 1; storeU8(memory, output + cursor, 47); }
  const length = capacity - cursor;
  copyMemory(memory, output, output + cursor, length);
  return wordToI32(word(length));
};

/** Validate a regular or link inode for arena-backed payload access. */
export const arenaInodeStatus = (memory: ThistleMemory, inode: U32): I32 => {
  const kind = thistleVfsKind(memory, inode);
  if (kind !== THISTLE_VFS_KIND_FILE && kind !== THISTLE_VFS_KIND_LINK) return -22;
  return (loadU32(memory, inodeAt(memory, inode) + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0 ? -18 : 0;
};

const readData = (memory: ThistleMemory, inode: U32, offset: U64, output: Ptr, length: U32): I32 => {
  const status = arenaInodeStatus(memory, inode);
  if (status !== 0) return status;
  const state = inodeAt(memory, inode);
  const size = loadU64(memory, state + V_SIZE);
  if (offset >= size) return 0;
  const available = size - offset;
  const amount = available < ux(word(length)) ? wordToU32(available) : length;
  if (amount !== 0) copyMemory(memory, output, loadU32(memory, state + V_DATA) + wordToU32(offset), amount);
  return wordToU32(word(amount));
};

export const thistleVfsReadData = (memory: ThistleMemory, inode: U32, offset: U64, output: Ptr, length: U32): I32 => {
  if (!inputContains(memory, output, length)) return -22;
  return readData(memory, inode, offset, output, length);
};

/** Descriptor read policy is independent of the output transport. */
export const descriptorReadStatus = (memory: ThistleMemory, state: Ptr): I32 => {
  const kind = loadU32(memory, state + FD_KIND);
  if (kind === THISTLE_FD_DIRECTORY) return -21;
  if (kind !== THISTLE_FD_FILE || (loadU32(memory, state + FD_FLAGS) & THISTLE_FD_READ) === 0) return -9;
  return 0;
};

/** Read arena bytes through a live descriptor and advance only on success. */
export const thistleVfsReadDescriptor = (memory: ThistleMemory, state: Ptr, output: Ptr, length: U32): I32 => {
  const status = descriptorReadStatus(memory, state);
  if (status !== 0 || length === 0) return status;
  const offset = loadU64(memory, state + FD_OFFSET);
  const amount = thistleVfsReadData(memory, loadU32(memory, state + FD_INODE), offset, output, length);
  if (amount > 0) storeU64(memory, state + FD_OFFSET, offset + ux(word(amount)));
  return amount;
};

export const thistleVfsSeekDescriptor = (memory: ThistleMemory, state: Ptr, offset: I64, whence: U32): I64 => {
  const kind = loadU32(memory, state + FD_KIND);
  if (kind !== THISTLE_FD_FILE && kind !== THISTLE_FD_DIRECTORY) return -9n;
  if (whence > 2) return -22n;
  const base: I64 = whence === 1 ? sx(loadU64(memory, state + FD_OFFSET), 64) :
    whence === 2 ? sx(thistleVfsFileSize(memory, loadU32(memory, state + FD_INODE)), 64) : 0n;
  const next = base + offset;
  if (next < 0n || next > 0x7fffffffffffffffn || (offset > 0n && next < base)) return -22n;
  storeU64(memory, state + FD_OFFSET, ux(next));
  return next;
};

// The caller holds the VFS lock. The destination is the fixed kernel scratch arena.
export const thistleVfsReadScratch = (memory: ThistleMemory, inode: U32, offset: U64, length: U32): I32 => {
  const output = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_SCRATCH_BASE);
  if (length > THISTLE_VFS_PATH_CAPACITY || !memoryContains(memory, output, length)) return -22;
  return readData(memory, inode, offset, output, length);
};

// Clear the old tables only after the image header and checksum have been validated.
function resetVfs(memory: ThistleMemory, inodeCapacity: U32, dentryCapacity: U32): void {
  const inodeBase = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_BASE);
  const dentryBase = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_BASE);
  const dataBase = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_BASE);
  const oldNext = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_NEXT);
  fill(memory, inodeBase, inodeCapacity * THISTLE_VFS_INODE_STRIDE, 0);
  fill(memory, dentryBase, dentryCapacity * THISTLE_VFS_DENTRY_STRIDE, 0);
  if (oldNext > dataBase) fill(memory, dataBase, oldNext - dataBase, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_NEXT, dataBase);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_LOADED, 0);
}

// Positive results are the next image cursor; negative results encode VFS status codes.
function loadInodes(memory: ThistleMemory, start: Ptr, end: Ptr, inodeCount: U32, inodeCapacity: U32, dataCapacity: U32): I64 {
  let cursor = start;
  let parsed: U32 = 0;
  while (parsed < inodeCount) {
    if (cursor > end || VFS_INODE_IMAGE_SIZE > end - cursor) return word(-THISTLE_VFS_FORMAT);
    const inode = loadU32(memory, cursor);
    const kind = loadU32(memory, cursor + 4);
    const payloadLength = loadU32(memory, cursor + 24);
    if (inode === 0 || inode >= inodeCapacity ||
        (kind !== THISTLE_VFS_KIND_FILE && kind !== THISTLE_VFS_KIND_DIRECTORY && kind !== THISTLE_VFS_KIND_LINK) ||
        loadU32(memory, cursor + 20) === 0 || payloadLength > dataCapacity ||
        (kind === THISTLE_VFS_KIND_DIRECTORY && payloadLength !== 0) ||
        cursor + VFS_INODE_IMAGE_SIZE > end || payloadLength > end - (cursor + VFS_INODE_IMAGE_SIZE)) return word(-THISTLE_VFS_FORMAT);
    const state = inodeAt(memory, inode);
    if (loadU32(memory, state + V_KIND) !== THISTLE_VFS_KIND_EMPTY) return word(-THISTLE_VFS_DUPLICATE);
    const data = allocateData(memory, payloadLength);
    if (data === 0xffffffff) return word(-THISTLE_VFS_CAPACITY_ERROR);
    if (payloadLength !== 0) copyMemory(memory, data, cursor + VFS_INODE_IMAGE_SIZE, payloadLength);
    storeU32(memory, state + V_KIND, kind);
    storeU32(memory, state + V_MODE, loadU32(memory, cursor + 8) & 0xfff);
    storeU32(memory, state + V_UID, loadU32(memory, cursor + 12));
    storeU32(memory, state + V_GID, loadU32(memory, cursor + 16));
    storeU32(memory, state + V_NLINK, loadU32(memory, cursor + 20));
    storeU32(memory, state + V_FLAGS, 0);
    storeU64(memory, state + V_SIZE, ux(word(payloadLength)));
    storeU32(memory, state + V_DATA, data);
    storeU32(memory, state + V_CAPACITY, payloadLength);
    storeU64(memory, state + V_ATIME, loadU64(memory, cursor + 32));
    storeU64(memory, state + V_MTIME, loadU64(memory, cursor + 40));
    storeU64(memory, state + V_CTIME, loadU64(memory, cursor + 48));
    const record = VFS_INODE_IMAGE_SIZE + payloadLength;
    const aligned = align4(record);
    if (aligned < record || aligned > end - cursor) return word(-THISTLE_VFS_FORMAT);
    cursor += aligned;
    parsed += 1;
  }
  return word(cursor);
}

// Entry names must refer to parsed inodes and remain unique within their parent directory.
function loadDentries(memory: ThistleMemory, start: Ptr, end: Ptr, dentryCount: U32, inodeCapacity: U32): I64 {
  let cursor = start;
  let parsed: U32 = 0;
  while (parsed < dentryCount) {
    if (cursor > end || VFS_DENTRY_IMAGE_SIZE > end - cursor) return word(-THISTLE_VFS_FORMAT);
    const parent = loadU32(memory, cursor);
    const inode = loadU32(memory, cursor + 4);
    const nameLength = loadU32(memory, cursor + 8);
    const nameAt = cursor + VFS_DENTRY_IMAGE_SIZE;
    if (parent === 0 || inode === 0 || parent >= inodeCapacity || inode >= inodeCapacity ||
        loadU32(memory, inodeAt(memory, parent) + V_KIND) !== THISTLE_VFS_KIND_DIRECTORY ||
        loadU32(memory, inodeAt(memory, inode) + V_KIND) === THISTLE_VFS_KIND_EMPTY ||
        nameLength > end - nameAt || !validName(memory, nameAt, nameLength)) return word(-THISTLE_VFS_FORMAT);
    const hash = hashBytes(memory, nameAt, nameLength);
    let scan: U32 = 0;
    while (scan < parsed) {
      const existing = dentryAt(memory, scan);
      if (loadU32(memory, existing + D_PARENT) === parent && sameName(memory, existing, nameAt, nameLength, hash)) {
        return word(-THISTLE_VFS_DUPLICATE);
      }
      scan += 1;
    }
    const name = allocateData(memory, nameLength);
    if (name === 0xffffffff) return word(-THISTLE_VFS_CAPACITY_ERROR);
    copyMemory(memory, name, nameAt, nameLength);
    const dentry = dentryAt(memory, parsed);
    storeU32(memory, dentry + D_PARENT, parent);
    storeU32(memory, dentry + D_INODE, inode);
    storeU32(memory, dentry + D_NAME, name);
    storeU32(memory, dentry + D_NAME_LENGTH, nameLength);
    storeU32(memory, dentry + D_NAME_HASH, hash);
    storeU32(memory, dentry + D_FLAGS, 0);
    const record = VFS_DENTRY_IMAGE_SIZE + nameLength;
    const aligned = align4(record);
    if (aligned < record || aligned > end - cursor) return word(-THISTLE_VFS_FORMAT);
    cursor += aligned;
    parsed += 1;
  }
  return word(cursor);
}

const processHoldsFile = (memory: ThistleMemory, proc: Ptr): boolean => {
  const table = loadU32(memory, proc + P_DESCRIPTOR_TABLE), capacity = loadU32(memory, proc + P_DESCRIPTOR_CAPACITY);
  let descriptor: U32 = 0;
  while (descriptor < capacity) {
    const at = table + descriptor * THISTLE_DESCRIPTOR_STRIDE;
    if (loadU32(memory, at + FD_KIND) !== 0 && loadU32(memory, at + FD_INODE) !== 0) return true;
    descriptor += 1;
  }
  return false;
};

// A root remount must not reinterpret open files or a process's non-root working directory.
const hasMountReferences = (memory: ThistleMemory): boolean => {
  if (!thistleVfsLoaded(memory)) return false;
  const root = thistleVfsRoot(memory), capacity = loadU32(memory, C_PROCESS_CAPACITY);
  const base = loadU32(memory, C_PROCESS_TABLE_BASE);
  let index: U32 = 0;
  while (index < capacity) {
    const proc = base + index * THISTLE_PROCESS_STRIDE;
    const cwd = loadU32(memory, proc + P_CWD_INODE);
    if (loadU32(memory, proc + P_STATE) !== 0 && (cwd !== 0 && cwd !== root || processHoldsFile(memory, proc))) return true;
    index += 1;
  }
  return false;
};

// Publish the mounted filesystem only when both record tables are validated.
function publishVfs(memory: ThistleMemory, inodeCount: U32, dentryCount: U32, root: U32): void {
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT, inodeCount);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT, dentryCount);
  const previousRoot = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT, root);
  const processBase = loadU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_TABLE_BASE);
  const processCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_CAPACITY);
  let processIndex: U32 = 0;
  while (processIndex < processCapacity) {
    const proc = processBase + processIndex * THISTLE_PROCESS_STRIDE;
    if (loadU32(memory, proc + P_STATE) !== wordToU32(word(THISTLE_PROCESS_EMPTY)) &&
        (loadU32(memory, proc + P_CWD_INODE) === 0 || loadU32(memory, proc + P_CWD_INODE) === previousRoot)) storeU32(memory, proc + P_CWD_INODE, root);
    processIndex += 1;
  }
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DIRTY, 0);
  atomicStoreU64(memory, THISTLE_CONTROL_BASE + C_VFS_GENERATION,
    atomicLoadU64(memory, THISTLE_CONTROL_BASE + C_VFS_GENERATION) + 1n);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_LOADED, 1);
}

export const thistleLoadVfs = (memory: ThistleMemory, image: Ptr, imageLength: U32): I32 => {
  if (!inputContains(memory, image, imageLength) || imageLength < VFS_HEADER_SIZE ||
      loadU32(memory, image) !== THISTLE_VFS_IMAGE_MAGIC || loadU32(memory, image + 4) !== THISTLE_VFS_IMAGE_VERSION ||
      loadU32(memory, image + 20) !== imageLength) return THISTLE_VFS_RANGE;
  const inodeCount = loadU32(memory, image + 8);
  const dentryCount = loadU32(memory, image + 12);
  const root = loadU32(memory, image + 16);
  const inodeCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY);
  const dentryCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_CAPACITY);
  const dataCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_END) -
    loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_BASE);
  if (inodeCount === 0 || inodeCount >= inodeCapacity || dentryCount > dentryCapacity ||
      root === 0 || root >= inodeCapacity) return THISTLE_VFS_CAPACITY_ERROR;
  if (hashBytes(memory, image + VFS_HEADER_SIZE, imageLength - VFS_HEADER_SIZE) !== loadU32(memory, image + 24)) {
    return THISTLE_VFS_CHECKSUM;
  }
  if (hasMountReferences(memory)) return THISTLE_VFS_BUSY;
  resetVfs(memory, inodeCapacity, dentryCapacity);
  const end = image + imageLength;
  const inodeResult = loadInodes(memory, image + VFS_HEADER_SIZE, end, inodeCount, inodeCapacity, dataCapacity);
  if (inodeResult < 0n) return wordToI32(-inodeResult);
  if (loadU32(memory, inodeAt(memory, root) + V_KIND) !== THISTLE_VFS_KIND_DIRECTORY) return THISTLE_VFS_FORMAT;
  const dentryResult = loadDentries(memory, Number(inodeResult), end, dentryCount, inodeCapacity);
  if (dentryResult < 0n) return wordToI32(-dentryResult);
  if (dentryResult !== word(end)) return THISTLE_VFS_FORMAT;
  publishVfs(memory, inodeCount, dentryCount, root);
  let versioned: U32 = 1;
  while (versioned < inodeCapacity) {
    const state = inodeAt(memory, versioned);
    if (loadU32(memory, state + V_KIND) !== 0) {
      const generation = atomicLoadU64(memory, C_VFS_GENERATION);
      storeU64(memory, state + V_VERSION, generation);
      storeU64(memory, state + V_IDENTITY, generation);
    }
    versioned += 1;
  }
  return THISTLE_VFS_OK;
};

export const thistleVfsRelease = (memory: ThistleMemory, inode: U32): void => {
  if (thistleVfsKind(memory, inode) === 0) return;
  const state = inodeAt(memory, inode);
  if (loadU32(memory, state + V_NLINK) !== 0) return;
  const base = loadU32(memory, C_PROCESS_TABLE_BASE);
  const count = loadU32(memory, C_PROCESS_CAPACITY);
  let index: U32 = 0;
  while (index < count) {
    const proc = base + index * THISTLE_PROCESS_STRIDE;
    const descriptors = loadU32(memory, proc + P_DESCRIPTOR_TABLE);
    const capacity = loadU32(memory, proc + P_DESCRIPTOR_CAPACITY);
    let fd: U32 = 0;
    while (loadU32(memory, proc + P_STATE) !== 0 && fd < capacity) {
      const at = descriptors + fd * THISTLE_DESCRIPTOR_STRIDE;
      if (loadU32(memory, at + FD_KIND) !== 0 && loadU32(memory, at + FD_INODE) === inode) return;
      fd += 1;
    }
    index += 1;
  }
  fill(memory, state, THISTLE_VFS_INODE_STRIDE, 0);
  storeU32(memory, C_VFS_INODE_COUNT, loadU32(memory, C_VFS_INODE_COUNT) - 1);
};


/** Caller holds the VFS lock. Open unlinked inodes remain charged until close. */
export const thistleVfsResidentUsage = (memory: ThistleMemory): U64 => {
  const capacity = loadU32(memory, C_VFS_INODE_CAPACITY);
  let inode: U32 = 1;
  let total: U64 = 0n;
  while (inode < capacity) {
    const state = inodeAt(memory, inode);
    const kind = loadU32(memory, state + V_KIND);
    if (kind !== 0) total += 128n;
    if (kind === THISTLE_VFS_KIND_FILE) total += (loadU32(memory, state + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0
      ? loadU64(memory, state + V_RESIDENT) : loadU64(memory, state + V_SIZE);
    inode += 1;
  }
  return total;
};

/** Check a resident-byte replacement against the canonical quota. */
export const residentFits = (memory: ThistleMemory, previous: U64, replacement: U64): boolean => {
  const limit = loadU64(memory, C_VFS_QUOTA);
  if (limit === 0n) return true;
  const used = thistleVfsResidentUsage(memory);
  return previous <= used && replacement <= limit && used - previous <= limit - replacement;
};

const copyDirectoryEntry = (memory: ThistleMemory, index: U32, output: Ptr, capacity: U32): I32 => {
  const entry = dentryAt(memory, index);
  const inode = loadU32(memory, entry + D_INODE), length = loadU32(memory, entry + D_NAME_LENGTH);
  if (length === 0 || length > 255) return -5;
  if (capacity < 16 + length) return -34;
  storeU32(memory, output, inode);
  storeU32(memory, output + 4, thistleVfsKind(memory, inode));
  storeU32(memory, output + 8, index + 1);
  storeU32(memory, output + 12, length);
  copyMemory(memory, output + 16, loadU32(memory, entry + D_NAME), length);
  return wordToI32(word(16 + length));
};

/** Read one live entry. Caller owns VFS lock and advances the returned cursor. */
export const thistleVfsReadEntry = (
  memory: ThistleMemory, proc: Ptr, parent: U32, cursor: U32, output: Ptr, capacity: U32,
): I32 => {
  if (thistleVfsKind(memory, parent) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (!allowed(memory, proc, parent, 4)) return -13;
  if (!inputContains(memory, output, capacity)) return -14;
  const count = loadU32(memory, C_VFS_DENTRY_COUNT);
  let index = cursor;
  while (index < count) {
    const entry = dentryAt(memory, index);
    if (loadU32(memory, entry + D_INODE) !== 0 && loadU32(memory, entry + D_PARENT) === parent)
      return copyDirectoryEntry(memory, index, output, capacity);
    index += 1;
  }
  return 0;
};
