import {
  C_VFS_DIRTY, C_VFS_GENERATION, C_VFS_QUOTA, THISTLE_VFS_HOST_BACKING,
  THISTLE_VFS_KIND_FILE, THISTLE_FD_READ, THISTLE_FD_WRITE, FD_INODE, FD_OFFSET, V_CAPACITY, V_CTIME, V_DATA, V_FLAGS,
  V_MODE, V_MTIME, V_RESIDENT, V_SIZE, V_VERSION, P_FSUID,
} from "./abi.js";
import { inputContains } from "./arena.js";
import { atomicLoadU64, atomicStoreU64, loadU32, loadU64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, Ptr, U32, U64 } from "./types.js";
import { u32word } from "./word.js";
import { allowed, descriptorAccessStatus, descriptorWriteOffset, inodeAt, residentFits, thistleVfsKind, thistleVfsResidentUsage } from "./vfs.js";

/** Configure an explicit resident quota before attaching host storage. Caller holds VFS lock. */
export const thistleVfsSetQuota = (memory: ThistleMemory, limit: U64): I32 => {
  if (limit === 0n || limit > 0x1fffffffffffffn) return -22;
  if (thistleVfsResidentUsage(memory) > limit) return -28;
  storeU64(memory, C_VFS_QUOTA, limit);
  return 0;
};

/** Return an opaque host byte-carrier handle, or zero for arena storage/missing inode. */
export const thistleVfsBacking = (memory: ThistleMemory, inode: U32): U32 => {
  if (thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_FILE) return 0;
  const state = inodeAt(memory, inode);
  return (loadU32(memory, state + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0 ? loadU32(memory, state + V_DATA) : 0;
};

/** Payload revision used to reject stale async storage completions. */
export const thistleVfsBackingVersion = (memory: ThistleMemory, inode: U32): U64 =>
  thistleVfsKind(memory, inode) === THISTLE_VFS_KIND_FILE ? loadU64(memory, inodeAt(memory, inode) + V_VERSION) : 0n;

// Descriptor: handle:u32, operation:u32, logical-size:u64, resident-bytes:u64.
// Operations: materialise=0, write=1, trusted restore=2. Restore retains image metadata.
export const thistleVfsCommitBacking = (
  memory: ThistleMemory, proc: Ptr, inode: U32, expected: U64, descriptor: Ptr, now: U64,
): I32 => {
  if (!inputContains(memory, descriptor, 24)) return -14;
  if (thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_FILE) return -22;
  const write = loadU32(memory, descriptor + 4);
  if (write > 2) return -22;
  if (write === 2 && loadU32(memory, proc + P_FSUID) !== 0) return -1;
  if (!allowed(memory, proc, inode, write === 0 ? 4 : 2)) return -13;
  return publishBacking(memory, inode, expected, descriptor, now);
};

/** Commit carrier metadata once authority has been checked by the caller. */
const publishBacking = (memory: ThistleMemory, inode: U32, expected: U64, descriptor: Ptr, now: U64): I32 => {
  const handle = loadU32(memory, descriptor), write = loadU32(memory, descriptor + 4);
  const size = loadU64(memory, descriptor + 8), resident = loadU64(memory, descriptor + 16);
  if (handle === 0 || write > 2 || size > 0x1fffffffffffffn || resident > size) return -22;
  const state = inodeAt(memory, inode);
  if (loadU64(memory, state + V_VERSION) !== expected) return -11;
  const oldSize = loadU64(memory, state + V_SIZE);
  if (write === 0 && size !== oldSize) return -22;
  if (loadU64(memory, C_VFS_QUOTA) === 0n) return -95;
  const oldResident = (loadU32(memory, state + V_FLAGS) & THISTLE_VFS_HOST_BACKING) !== 0
    ? loadU64(memory, state + V_RESIDENT) : oldSize;
  if (!residentFits(memory, oldResident, resident)) return -28;
  storeU32(memory, state + V_DATA, handle);
  storeU32(memory, state + V_CAPACITY, 0);
  storeU32(memory, state + V_FLAGS, loadU32(memory, state + V_FLAGS) | THISTLE_VFS_HOST_BACKING);
  storeU64(memory, state + V_SIZE, size);
  storeU64(memory, state + V_RESIDENT, resident);
  storeU64(memory, state + V_VERSION, expected + 1n);
  if (write === 1) {
    storeU32(memory, state + V_MODE, loadU32(memory, state + V_MODE) & ~0o6000);
    storeU64(memory, state + V_MTIME, now);
    storeU64(memory, state + V_CTIME, now);
  }
  storeU32(memory, C_VFS_DIRTY, 1);
  atomicStoreU64(memory, C_VFS_GENERATION, atomicLoadU64(memory, C_VFS_GENERATION) + 1n);
  return 0;
};

/** Publish through a live open file, not through its former pathname permissions. */
export const thistleVfsCommitDescriptorBacking = (
  memory: ThistleMemory, state: Ptr, expected: U64, descriptor: Ptr, length: U32, now: U64,
): I32 => {
  if (!inputContains(memory, descriptor, 24)) return -14;
  const operation = loadU32(memory, descriptor + 4);
  if (operation > 1 || (operation === 0 && length !== 0)) return -22;
  const status = descriptorAccessStatus(memory, state, operation === 0 ? THISTLE_FD_READ | THISTLE_FD_WRITE : THISTLE_FD_WRITE);
  if (status !== 0) return status;
  const inode = loadU32(memory, state + FD_INODE);
  if (thistleVfsBacking(memory, inode) === 0) return -18;
  const next = descriptorWriteOffset(memory, state) + u32word(length);
  if (operation === 1 && (length === 0 || next > loadU64(memory, descriptor + 8) ||
      next > 0x1fffffffffffffn)) return -22;
  const result = publishBacking(memory, inode, expected, descriptor, now);
  if (result === 0 && operation === 1) storeU64(memory, state + FD_OFFSET, next);
  return result;
};
