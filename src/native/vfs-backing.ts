import {
  C_VFS_DIRTY, C_VFS_GENERATION, C_VFS_QUOTA, THISTLE_VFS_HOST_BACKING,
  THISTLE_VFS_KIND_FILE, V_CAPACITY, V_CTIME, V_DATA, V_FLAGS,
  V_MODE, V_MTIME, V_RESIDENT, V_SIZE, V_VERSION,
} from "./abi.js";
import { inputContains } from "./arena.js";
import { atomicLoadU64, atomicStoreU64, loadU32, loadU64, storeU32, storeU64 } from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { I32, Ptr, U32, U64 } from "./types.js";
import { allowed, inodeAt, residentFits, thistleVfsKind, thistleVfsResidentUsage } from "./vfs.js";

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

// Descriptor: handle:u32, write:u32, logical-size:u64, resident-bytes:u64.
// Materialisation (write=0) retains logical size, times and set-ID bits.
export const thistleVfsCommitBacking = (
  memory: ThistleMemory, proc: Ptr, inode: U32, expected: U64, descriptor: Ptr, now: U64,
): I32 => {
  if (!inputContains(memory, descriptor, 24)) return -14;
  if (thistleVfsKind(memory, inode) !== THISTLE_VFS_KIND_FILE) return -22;
  const handle = loadU32(memory, descriptor), write = loadU32(memory, descriptor + 4);
  const size = loadU64(memory, descriptor + 8), resident = loadU64(memory, descriptor + 16);
  if (handle === 0 || write > 1 || size > 0x1fffffffffffffn || resident > size) return -22;
  if (!allowed(memory, proc, inode, write === 0 ? 4 : 2)) return -13;
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
  if (write !== 0) {
    storeU32(memory, state + V_MODE, loadU32(memory, state + V_MODE) & ~0o6000);
    storeU64(memory, state + V_MTIME, now);
    storeU64(memory, state + V_CTIME, now);
  }
  storeU32(memory, C_VFS_DIRTY, 1);
  atomicStoreU64(memory, C_VFS_GENERATION, atomicLoadU64(memory, C_VFS_GENERATION) + 1n);
  return 0;
};
