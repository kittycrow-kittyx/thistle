import { bad } from "../core/err.js";
import { C_VFS_LOCK, THISTLE_THX_BUSY } from "../native/abi.js";
import { atomicStoreI32, compareExchangeI32 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleImageReserve, thistleImageRelease } from "../native/kernel.js";

export const withVfsLock = <T>(memory: ThistleMemory, operation: () => T): T => {
  if (compareExchangeI32(memory, C_VFS_LOCK, 0, 1) !== 0) bad("EAGAIN", "VFS is busy");
  try { return operation(); }
  finally { atomicStoreI32(memory, C_VFS_LOCK, 0); }
};

const releaseImage = (memory: ThistleMemory, input: number, size: number): void => {
  const status = thistleImageRelease(memory, input, size);
  if (status === 0) return;
  if (status !== THISTLE_THX_BUSY) bad("EFAULT", "input lease ownership changed");
  setTimeout(() => releaseImage(memory, input, size), 0);
};

/** The operation is synchronous; deferred cleanup retries only contended release. */
export const withImage = <T>(memory: ThistleMemory, size: number, operation: (input: number) => T): T => {
  const input = thistleImageReserve(memory, size);
  if (input === 0xffffffff) bad("EAGAIN", "input lease unavailable");
  try { return operation(input); }
  finally { releaseImage(memory, input, size); }
};
