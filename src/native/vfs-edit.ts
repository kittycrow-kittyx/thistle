import {
  C_VFS_DENTRY_CAPACITY, C_VFS_DENTRY_COUNT, C_VFS_DIRTY, C_VFS_GENERATION,
  C_VFS_INODE_CAPACITY, C_VFS_INODE_COUNT, D_INODE, D_NAME, D_NAME_HASH,
  D_NAME_LENGTH, D_PARENT, P_FSGID, P_FSUID, THISTLE_CONTROL_BASE,
  THISTLE_VFS_INODE_STRIDE, THISTLE_VFS_KIND_CHARACTER, THISTLE_VFS_KIND_DIRECTORY,
  THISTLE_VFS_KIND_FILE, THISTLE_VFS_KIND_LINK, V_ATIME, V_CAPACITY, V_CTIME,
  V_DATA, V_FLAGS, V_VERSION, V_IDENTITY, THISTLE_VFS_HOST_BACKING, V_GID, V_KIND, V_MODE, V_MTIME, V_NLINK, V_SIZE, V_UID,
} from "./abi.js";
import { word, ux, wordToU32 } from "./word.js";
import { inputContains } from "./arena.js";
import { atomicLoadU64, atomicStoreU64, copyMemory, fill, loadU32, loadU64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, Ptr, U32, U64 } from "./types.js";
import {
  allocateData, allowed, residentFits, growData, dentryAt, findChild, hashBytes, inodeAt, parentOf,
  sameName, thistleVfsKind, thistleVfsRelease, validName,
} from "./vfs.js";

// These operations run while the canonical kernel's VFS lock is held.
// Host adapters marshal buffers and identities; they do not own inode state.
const changed = (memory: ThistleMemory): void => {
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DIRTY, 1);
  atomicStoreU64(memory, THISTLE_CONTROL_BASE + C_VFS_GENERATION,
    atomicLoadU64(memory, THISTLE_CONTROL_BASE + C_VFS_GENERATION) + 1n);
};

const touch = (memory: ThistleMemory, inode: U32, now: U64, data: boolean): void => {
  const state = inodeAt(memory, inode);
  storeU64(memory, state + V_CTIME, now);
  if (data) storeU64(memory, state + V_MTIME, now);
};

const freeInode = (memory: ThistleMemory): U32 => {
  const capacity = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY);
  let inode: U32 = 1;
  while (inode < capacity) {
    if (thistleVfsKind(memory, inode) === 0) return inode;
    inode += 1;
  }
  return 0;
};

const freeEntry = (memory: ThistleMemory): U32 => {
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  let index: U32 = 0;
  while (index < count) {
    if (loadU32(memory, dentryAt(memory, index) + D_INODE) === 0) return index;
    index += 1;
  }
  return count;
};

const entryFor = (memory: ThistleMemory, parent: U32, name: Ptr, length: U32): Ptr => {
  const hash = hashBytes(memory, name, length);
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const at = dentryAt(memory, index);
    if (loadU32(memory, at + D_PARENT) === parent && loadU32(memory, at + D_INODE) !== 0 && sameName(memory, at, name, length, hash)) return at;
    index += 1;
  }
  return 0;
};

const parentAccess = (memory: ThistleMemory, proc: Ptr, parent: U32): I32 => {
  if (thistleVfsKind(memory, parent) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  return allowed(memory, proc, parent, 3) ? 0 : -13;
};

/** Attach a new name to canonical inode state. The input must be a reserved image. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
const attachEntry = (
  memory: ThistleMemory, proc: Ptr, parent: U32, inode: U32,
  name: Ptr, length: U32, now: U64,
): I32 => {
  const access = parentAccess(memory, proc, parent);
  if (access !== 0) return access;
  if (!inputContains(memory, name, length) || !validName(memory, name, length)) return -22;
  if (thistleVfsKind(memory, inode) === 0) return -2;
  if (findChild(memory, parent, name, length) !== 0) return -17;
  const index = freeEntry(memory);
  if (index >= loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_CAPACITY)) return -28;
  const stored = allocateData(memory, length);
  if (stored === 0xffffffff) return -28;
  copyMemory(memory, stored, name, length);
  const at = dentryAt(memory, index);
  storeU32(memory, at + D_PARENT, parent);
  storeU32(memory, at + D_INODE, inode);
  storeU32(memory, at + D_NAME, stored);
  storeU32(memory, at + D_NAME_LENGTH, length);
  storeU32(memory, at + D_NAME_HASH, hashBytes(memory, name, length));
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  if (index === count) storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT, count + 1);
  const state = inodeAt(memory, inode);
  storeU32(memory, state + V_NLINK, loadU32(memory, state + V_NLINK) + 1);
  touch(memory, inode, now, false);
  touch(memory, parent, now, true);
  changed(memory);
  return inode;
};

/** Hard links share canonical inode identity and cannot link directories. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsLink = (
  memory: ThistleMemory, proc: Ptr, parent: U32, inode: U32,
  name: Ptr, length: U32, now: U64,
): I32 => {
  if (thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_DIRECTORY) return -1;
  return attachEntry(memory, proc, parent, inode, name, length, now);
};

/** Allocate and attach an inode without publishing partial state on failure. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsCreate = (
  memory: ThistleMemory, proc: Ptr, parent: U32, name: Ptr, length: U32,
  kind: U32, mode: U32, now: U64,
): I32 => {
  if (kind < THISTLE_VFS_KIND_FILE || kind > THISTLE_VFS_KIND_CHARACTER) return -22;
  if (!residentFits(memory, 0n, 128n)) return -28;
  const inode = freeInode(memory);
  if (inode === 0) return -28;
  const at = inodeAt(memory, inode);
  fill(memory, at, THISTLE_VFS_INODE_STRIDE, 0);
  storeU32(memory, at + V_KIND, kind);
  const generation = atomicLoadU64(memory, C_VFS_GENERATION) + 1n;
  storeU64(memory, at + V_VERSION, generation);
  storeU64(memory, at + V_IDENTITY, generation);
  storeU32(memory, at + V_MODE, mode & 0o7777);
  storeU32(memory, at + V_UID, loadU32(memory, proc + P_FSUID));
  storeU32(memory, at + V_GID, loadU32(memory, proc + P_FSGID));
  storeU64(memory, at + V_ATIME, now);
  storeU64(memory, at + V_MTIME, now);
  const result = attachEntry(memory, proc, parent, inode, name, length, now);
  if (result < 0) { fill(memory, at, THISTLE_VFS_INODE_STRIDE, 0); return result; }
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT, count + 1);
  return inode;
};

/** Write or replace bytes in the canonical data arena; old bytes survive ENOSPC. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsWrite = (
  memory: ThistleMemory, proc: Ptr, inode: U32, input: Ptr, length: U32,
  offset: U32, replace: boolean, now: U64,
): I32 => {
  const kind = thistleVfsKind(memory, inode);
  if (kind !== THISTLE_VFS_KIND_FILE && kind !== THISTLE_VFS_KIND_LINK) return -22;
  if (!inputContains(memory, input, length)) return -14;
  if (!allowed(memory, proc, inode, 2)) return -13;
  const state = inodeAt(memory, inode);
  if ((loadU32(memory, state + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0) return -18;
  const oldSize = loadU64(memory, state + V_SIZE);
  if (oldSize > 0xffffffffn || offset > 0x7fffffff || length > 0x7fffffff - offset) return -27;
  const required = offset + length;
  const size: U32 = replace || oldSize < ux(word(required)) ? required : wordToU32(oldSize);
  if (kind === THISTLE_VFS_KIND_FILE && !residentFits(memory, oldSize, ux(word(size)))) return -28;
  const capacity = loadU32(memory, state + V_CAPACITY);
  const previous = loadU32(memory, state + V_DATA);
  const data = size > capacity ? growData(memory, inode, size) : previous;
  if (data === 0xffffffff) return -28;
  if (size > capacity && !replace && oldSize !== 0n && data !== previous) copyMemory(memory, data, previous, wordToU32(oldSize));
  const kept: U32 = replace ? 0 : wordToU32(oldSize);
  if (offset > kept) fill(memory, data + kept, offset - kept, 0);
  if (length !== 0) copyMemory(memory, data + offset, input, length);
  storeU32(memory, state + V_DATA, data);
  storeU32(memory, state + V_CAPACITY, size > capacity ? size : capacity);
  storeU64(memory, state + V_SIZE, ux(word(size)));
  storeU32(memory, state + V_MODE, loadU32(memory, state + V_MODE) & ~0o6000);
  storeU64(memory, state + V_VERSION, loadU64(memory, state + V_VERSION) + 1n);
  touch(memory, inode, now, true);
  changed(memory);
  return length;
};

const hasChildren = (memory: ThistleMemory, inode: U32): boolean => {
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const at = dentryAt(memory, index);
    if (loadU32(memory, at + D_PARENT) === inode && loadU32(memory, at + D_INODE) !== 0) return true;
    index += 1;
  }
  return false;
};

/** Remove a directory entry while retaining an inode referenced by descriptors. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsUnlink = (
  memory: ThistleMemory, proc: Ptr, parent: U32, name: Ptr,
  length: U32, directory: boolean, now: U64,
): I32 => {
  const access = parentAccess(memory, proc, parent);
  if (access !== 0) return access;
  if (!inputContains(memory, name, length) || !validName(memory, name, length)) return -22;
  const inode = findChild(memory, parent, name, length);
  if (inode === 0) return -2;
  const isDirectory = thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_DIRECTORY;
  if (isDirectory && !directory) return -21;
  if (!isDirectory && directory) return -20;
  if (isDirectory && hasChildren(memory, inode)) return -39;
  const at = entryFor(memory, parent, name, length);
  if (at === 0) return -2;
  storeU32(memory, at + D_INODE, 0);
  storeU32(memory, at + D_PARENT, 0);
  const state = inodeAt(memory, inode);
  storeU32(memory, state + V_NLINK, loadU32(memory, state + V_NLINK) - 1);
  touch(memory, inode, now, false);
  touch(memory, parent, now, true);
  thistleVfsRelease(memory, inode);
  changed(memory);
  return 0;
};

/** Reject moves into a directory's own descendants before changing any entry. */
export const thistleVfsCanMove = (memory: ThistleMemory, inode: U32, parent: U32): boolean => {
  if (thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_DIRECTORY) return true;
  let current = parent;
  let remaining = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY);
  while (current !== 0 && remaining !== 0) {
    if (current === inode) return false;
    const next = parentOf(memory, current);
    if (next === current) return true;
    current = next;
    remaining -= 1;
  }
  return current === 0;
};


/** Reclaim only nameless inodes with no canonical descriptor reference. */
export { thistleVfsRelease } from "./vfs.js";

/** Rename one entry atomically after validating both parents and destination. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsRename = (
  memory: ThistleMemory, proc: Ptr, parent: U32, name: Ptr, length: U32,
  destination: U32, newName: Ptr, newLength: U32, now: U64,
): I32 => {
  const sourceAccess = parentAccess(memory, proc, parent);
  if (sourceAccess !== 0) return sourceAccess;
  const destinationAccess = parentAccess(memory, proc, destination);
  if (destinationAccess !== 0) return destinationAccess;
  if (!inputContains(memory, name, length) || !validName(memory, name, length) ||
      !inputContains(memory, newName, newLength) || !validName(memory, newName, newLength)) return -22;
  const inode = findChild(memory, parent, name, length);
  if (inode === 0) return -2;
  const replaced = findChild(memory, destination, newName, newLength);
  if (replaced === inode) return 0;
  if (!thistleVfsCanMove(memory, inode, destination)) return -22;
  const kind = thistleVfsKind(memory, inode), previous = thistleVfsKind(memory, replaced);
  if (kind !== THISTLE_VFS_KIND_DIRECTORY && previous === THISTLE_VFS_KIND_DIRECTORY) return -21;
  if (kind === THISTLE_VFS_KIND_DIRECTORY && replaced !== 0 && previous !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (previous === THISTLE_VFS_KIND_DIRECTORY && hasChildren(memory, replaced)) return -39;
  const stored = allocateData(memory, newLength);
  if (stored === 0xffffffff) return -28;
  copyMemory(memory, stored, newName, newLength);
  const at = entryFor(memory, parent, name, length);
  if (replaced !== 0) {
    const old = entryFor(memory, destination, newName, newLength);
    storeU32(memory, old + D_INODE, 0);
    storeU32(memory, old + D_PARENT, 0);
    const state = inodeAt(memory, replaced);
    storeU32(memory, state + V_NLINK, loadU32(memory, state + V_NLINK) - 1);
    touch(memory, replaced, now, false);
    thistleVfsRelease(memory, replaced);
  }
  storeU32(memory, at + D_PARENT, destination);
  storeU32(memory, at + D_NAME, stored);
  storeU32(memory, at + D_NAME_LENGTH, newLength);
  storeU32(memory, at + D_NAME_HASH, hashBytes(memory, newName, newLength));
  touch(memory, parent, now, true);
  touch(memory, destination, now, true);
  changed(memory);
  return 0;
};

/** Permission decisions for metadata changes stay in the canonical kernel. */
export const thistleVfsChmod = (memory: ThistleMemory, proc: Ptr, inode: U32, mode: U32, now: U64): I32 => {
  if (thistleVfsKind(memory, inode) === 0) return -2;
  const at = inodeAt(memory, inode), uid = loadU32(memory, proc + P_FSUID);
  if (uid !== 0 && uid !== loadU32(memory, at + V_UID)) return -1;
  storeU32(memory, at + V_MODE, mode & 0o7777);
  touch(memory, inode, now, false);
  changed(memory);
  return 0;
};

export const thistleVfsChown = (memory: ThistleMemory, proc: Ptr, inode: U32, uid: U32, gid: U32, now: U64): I32 => {
  if (thistleVfsKind(memory, inode) === 0) return -2;
  if (loadU32(memory, proc + P_FSUID) !== 0) return -1;
  const at = inodeAt(memory, inode);
  storeU32(memory, at + V_UID, uid); storeU32(memory, at + V_GID, gid);
  storeU32(memory, at + V_MODE, loadU32(memory, at + V_MODE) & ~0o6000);
  touch(memory, inode, now, false);
  changed(memory);
  return 0;
};

export const thistleVfsUtime = (memory: ThistleMemory, proc: Ptr, inode: U32, atime: U64, mtime: U64, now: U64): I32 => {
  if (thistleVfsKind(memory, inode) === 0) return -2;
  const at = inodeAt(memory, inode), uid = loadU32(memory, proc + P_FSUID);
  if (uid !== 0 && uid !== loadU32(memory, at + V_UID)) return -1;
  storeU64(memory, at + V_ATIME, atime); storeU64(memory, at + V_MTIME, mtime);
  touch(memory, inode, now, false);
  changed(memory);
  return 0;
};
