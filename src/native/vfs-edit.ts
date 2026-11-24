import {
  C_VFS_DENTRY_CAPACITY, C_VFS_DENTRY_COUNT, C_VFS_DIRTY, C_VFS_GENERATION, C_VFS_SCRATCH_BASE, THISTLE_VFS_PATH_CAPACITY, P_CWD_INODE, P_UMASK, THISTLE_FD_READ, THISTLE_FD_APPEND, THISTLE_FD_CLOEXEC, V_RESIDENT,
  C_VFS_INODE_CAPACITY, C_VFS_INODE_COUNT, D_INODE, D_NAME, D_NAME_HASH,
  D_NAME_LENGTH, D_PARENT, FD_INODE, FD_OFFSET, THISTLE_FD_WRITE, P_FSGID, P_FSUID, THISTLE_CONTROL_BASE,
  THISTLE_VFS_INODE_STRIDE, THISTLE_VFS_KIND_CHARACTER, THISTLE_VFS_KIND_DIRECTORY,
  THISTLE_VFS_KIND_FILE, THISTLE_VFS_KIND_LINK, V_ATIME, V_CAPACITY, V_CTIME,
  V_DATA, V_FLAGS, V_VERSION, V_IDENTITY, THISTLE_VFS_HOST_BACKING, V_GID, V_KIND, V_MODE, V_MTIME, V_NLINK, V_SIZE, V_UID,
} from "./abi.js";
import { word, ux, wordToI32, wordToU32 } from "./word.js";
import { inputContains } from "./arena.js";
import { atomicLoadU64, atomicStoreU64, copyMemory, fill, loadU8, loadU32, loadU64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, Ptr, U32, U64 } from "./types.js";
import {
  allocateData, allocateInodeDescriptor, freeDescriptor, descriptorAt, thistleVfsResolve, thistleVfsOpenInode, allowed, arenaInodeStatus, residentFits, growData, dentryAt, findChild, hashBytes, inodeAt, parentOf,
  sameName, thistleVfsKind, thistleVfsRelease, thistleVfsCwdHeld, descriptorAccessStatus, descriptorWriteOffset, validName,
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

/** Attach a new name from validated kernel memory to canonical inode state. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
const attachEntry = (
  memory: ThistleMemory, proc: Ptr, parent: U32, inode: U32,
  name: Ptr, length: U32, now: U64,
): I32 => {
  const access = parentAccess(memory, proc, parent);
  if (access !== 0) return access;
  if (!validName(memory, name, length)) return -22;
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
  if (!inputContains(memory, name, length)) return -22;
  return attachEntry(memory, proc, parent, inode, name, length, now);
};

/** Allocate and attach an inode without publishing partial state on failure. */
// The native ABI passes scalar arguments without allocating an options record.
//@cg-expect-warning
export const thistleVfsCreate = (
  memory: ThistleMemory, proc: Ptr, parent: U32, name: Ptr, length: U32,
  kind: U32, mode: U32, now: U64,
): I32 => {
  if (!inputContains(memory, name, length)) return -22;
  return createInode(memory, proc, parent, name, length, kind, mode, now);
};

// The caller supplies a name in validated kernel memory and holds the VFS lock.
//@cg-expect-warning
const createInode = (
  memory: ThistleMemory, proc: Ptr, parent: U32, name: Ptr, length: U32,
  kind: U32, mode: U32, now: U64,
): I32 => {
  const result = prepareInode(memory, proc, kind, mode, now);
  if (result < 0) return result;
  const inode = wordToU32(word(result));
  return completeInode(memory, inode, attachEntry(memory, proc, parent, inode, name, length, now));
};

const prepareInode = (memory: ThistleMemory, proc: Ptr, kind: U32, mode: U32, now: U64): I32 => {
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
  return wordToI32(word(inode));
};

const completeInode = (memory: ThistleMemory, inode: U32, result: I32): I32 => {
  if (result < 0) { fill(memory, inodeAt(memory, inode), THISTLE_VFS_INODE_STRIDE, 0); return result; }
  const count = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT, count + 1);
  return wordToI32(word(inode));
};

/** Publish a complete symlink, never an empty or partially written live entry.
 * Input contains name length, target length, then both UTF-8 byte strings.
 */
export const thistleVfsCreateSymlink = (memory: ThistleMemory, proc: Ptr, parent: U32, input: Ptr, now: U64): I32 => {
  if (!inputContains(memory, input, 8)) return -14;
  const nameLength = loadU32(memory, input), targetLength = loadU32(memory, input + 4);
  if (nameLength > 255 || targetLength > 4096) return -36;
  if (targetLength === 0) return -2;
  if (!inputContains(memory, input, 8 + nameLength + targetLength)) return -14;
  const name = input + 8, target = name + nameLength;
  if (!validName(memory, name, nameLength)) return -22;
  const access = parentAccess(memory, proc, parent);
  if (access !== 0) return access;
  if (findChild(memory, parent, name, nameLength) !== 0) return -17;
  let offset: U32 = 0;
  while (offset < targetLength) {
    if (loadU8(memory, target + offset) === 0) return -22;
    offset += 1;
  }
  const result = prepareInode(memory, proc, THISTLE_VFS_KIND_LINK, 0o777, now);
  if (result < 0) return result;
  const inode = wordToU32(word(result)), at = inodeAt(memory, inode);
  const data = allocateData(memory, targetLength);
  if (data === 0xffffffff) return completeInode(memory, inode, -28);
  copyMemory(memory, data, target, targetLength);
  storeU32(memory, at + V_DATA, data);
  storeU32(memory, at + V_CAPACITY, targetLength);
  storeU64(memory, at + V_SIZE, ux(word(targetLength)));
  return completeInode(memory, inode, attachEntry(memory, proc, parent, inode, name, nameLength, now));
};

const OPEN_CREATE: U32 = 0x40;
const OPEN_EXCLUSIVE: U32 = 0x80;
const OPEN_TRUNCATE: U32 = 0x200;
const OPEN_APPEND: U32 = 0x400;
const OPEN_DIRECTORY: U32 = 0x10000;
const OPEN_NOFOLLOW: U32 = 0x20000;
const OPEN_CLOEXEC: U32 = 0x80000;
const OPEN_SUPPORTED: U32 = 3 | OPEN_CREATE | OPEN_EXCLUSIVE | OPEN_TRUNCATE | OPEN_APPEND |
  0x800 | 0x8000 | OPEN_DIRECTORY | OPEN_NOFOLLOW | OPEN_CLOEXEC;

/** Resolve an absent final component without lexical normalisation of its parent. */
// The scalar arguments carry the same native path and inode authority as open.
//@cg-expect-warning
const createMissingFile = (
  memory: ThistleMemory, proc: Ptr, base: U32, path: Ptr, length: U32,
  mode: U32, now: U64, hops: U32,
): I32 => {
  if (hops > 32) return -40;
  if (length === 0) return -2;
  if (loadU8(memory, path + length - 1) === 47) return -21;
  let name = path + length;
  while (name > path && loadU8(memory, name - 1) !== 47) name -= 1;
  const parentResult: I32 = name === path ? wordToI32(word(base)) :
    thistleVfsResolve(memory, proc, base, path, name - path, true);
  if (parentResult < 0) return parentResult;
  const parent = wordToU32(word(parentResult)), nameLength = path + length - name;
  if (thistleVfsKind(memory, parent) !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (!allowed(memory, proc, parent, 1)) return -13;
  if (nameLength > 255) return -36;
  if (!validName(memory, name, nameLength)) return -22;
  const existing = findChild(memory, parent, name, nameLength);
  if (existing === 0) return createInode(memory, proc, parent, name, nameLength, THISTLE_VFS_KIND_FILE, mode, now);
  if (thistleVfsKind(memory, existing) !== THISTLE_VFS_KIND_LINK) return -17;
  const link = inodeAt(memory, existing), size = loadU64(memory, link + V_SIZE);
  if (size > 4096n) return -36;
  return createMissingFile(memory, proc, parent, loadU32(memory, link + V_DATA), wordToU32(size), mode, now, hops + 1);
};

/** Truncation to zero needs no carrier I/O and invalidates pending payload revisions. */
const truncateInode = (memory: ThistleMemory, inode: U32, now: U64): void => {
  const state = inodeAt(memory, inode);
  storeU32(memory, state + V_FLAGS, loadU32(memory, state + V_FLAGS) & ~THISTLE_VFS_HOST_BACKING);
  storeU32(memory, state + V_DATA, 0);
  storeU32(memory, state + V_CAPACITY, 0);
  storeU64(memory, state + V_RESIDENT, 0n);
  storeU64(memory, state + V_SIZE, 0n);
  storeU32(memory, state + V_MODE, loadU32(memory, state + V_MODE) & ~0o6000);
  storeU64(memory, state + V_VERSION, loadU64(memory, state + V_VERSION) + 1n);
  touch(memory, inode, now, true);
  changed(memory);
};

/** Reserve a descriptor slot before creating a new file. */
// The native ABI passes the original path, mode, rights and timestamp.
//@cg-expect-warning
const createOpenedFile = (
  memory: ThistleMemory, proc: Ptr, base: U32, path: Ptr, length: U32,
  mode: U32, rights: U32, now: U64,
): I32 => {
  if (freeDescriptor(memory, proc, 3) < 0) return -24;
  const made = createMissingFile(memory, proc, base, path, length, mode & ~loadU32(memory, proc + P_UMASK), now, 0);
  if (made < 0) return made;
  return allocateInodeDescriptor(memory, proc, wordToU32(word(made)), rights, 3);
};

/** Common Linux-style path open; caller holds descriptor, credential and VFS locks. */
// The native ABI passes scalar path, flags, mode and time without a host record.
//@cg-expect-warning
export const thistleVfsOpenPath = (
  memory: ThistleMemory, proc: Ptr, start: U32, path: Ptr, length: U32,
  flags: U32, mode: U32, now: U64,
): I32 => {
  const access = flags & 3, create = (flags & OPEN_CREATE) !== 0, truncate = (flags & OPEN_TRUNCATE) !== 0;
  const directory = (flags & OPEN_DIRECTORY) !== 0;
  if (access === 3 || (flags & ~OPEN_SUPPORTED) !== 0 || (create && directory) || (truncate && access === 0)) return -22;
  const base = start === 0 ? loadU32(memory, proc + P_CWD_INODE) : start;
  const exclusive = create && (flags & OPEN_EXCLUSIVE) !== 0;
  const nofollow = exclusive || (flags & OPEN_NOFOLLOW) !== 0;
  const resolved = thistleVfsResolve(memory, proc, base, path, length, !nofollow);
  const rights: U32 = access === 0 ? THISTLE_FD_READ : access === 1 ? THISTLE_FD_WRITE : THISTLE_FD_READ | THISTLE_FD_WRITE;
  const extra: U32 = ((flags & OPEN_CLOEXEC) !== 0 ? THISTLE_FD_CLOEXEC : 0) |
    ((flags & OPEN_APPEND) !== 0 && access !== 0 ? THISTLE_FD_APPEND : 0);
  if (resolved === -2 && create) return createOpenedFile(memory, proc, base, path, length, mode, rights | extra, now);
  if (resolved < 0) return resolved;
  if (exclusive) return -17;
  const inode = wordToU32(word(resolved)), kind = thistleVfsKind(memory, inode);
  if (nofollow && kind === THISTLE_VFS_KIND_LINK) return -40;
  if (directory && kind !== THISTLE_VFS_KIND_DIRECTORY) return -20;
  if (kind === THISTLE_VFS_KIND_DIRECTORY && (create || truncate)) return -21;
  if (kind === THISTLE_VFS_KIND_CHARACTER) return -18;
  const descriptor = thistleVfsOpenInode(memory, proc, inode, rights | extra, 3);
  if (descriptor < 0 || !truncate) return descriptor;
  truncateInode(memory, inode, now);
  storeU64(memory, descriptorAt(memory, proc, wordToU32(word(descriptor))) + FD_OFFSET, 0n);
  return descriptor;
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
  return writeInodeData(memory, inode, input, length, offset, replace, now);
};

// Scalar native payload operation shared by path and descriptor entry points.
//@cg-expect-warning
const writeInodeData = (
  memory: ThistleMemory, inode: U32, input: Ptr, length: U32, offset: U32, replace: boolean, now: U64,
): I32 => {
  const status = arenaInodeStatus(memory, inode);
  if (status !== 0) return status;
  const kind = thistleVfsKind(memory, inode);
  const state = inodeAt(memory, inode);
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

/** Descriptor authority comes from open flags, including after rename or unlink. */
export const thistleVfsWriteDescriptor = (memory: ThistleMemory, state: Ptr, input: Ptr, length: U32, now: U64): I32 => {
  if (length !== 0 && !inputContains(memory, input, length)) return -14;
  return writeDescriptorData(memory, state, input, length, now);
};

/** The mounted RV64 syscall supplies bytes in the locked kernel scratch region. */
export const thistleVfsWriteScratch = (memory: ThistleMemory, state: Ptr, length: U32, now: U64): I32 => {
  if (length > THISTLE_VFS_PATH_CAPACITY) return -22;
  return writeDescriptorData(memory, state, loadU32(memory, C_VFS_SCRATCH_BASE), length, now);
};

const writeDescriptorData = (memory: ThistleMemory, state: Ptr, input: Ptr, length: U32, now: U64): I32 => {
  const status = descriptorAccessStatus(memory, state, THISTLE_FD_WRITE);
  if (status !== 0) return status;
  if (length === 0) return 0;
  const inode = loadU32(memory, state + FD_INODE);
  if ((loadU32(memory, inodeAt(memory, inode) + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0) return -18;
  const offset = descriptorWriteOffset(memory, state);
  if (offset > 0x7fffffffn) return -27;
  const amount = writeInodeData(memory, inode, input, length, wordToU32(offset), false, now);
  if (amount > 0) storeU64(memory, state + FD_OFFSET, offset + ux(word(amount)));
  return amount;
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
  if (isDirectory && thistleVfsCwdHeld(memory, inode)) return -16;
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
  if (previous === THISTLE_VFS_KIND_DIRECTORY && thistleVfsCwdHeld(memory, replaced)) return -16;
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
