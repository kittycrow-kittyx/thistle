import { directMemory } from "../native/memory.js";
import type { HostBacking } from "./backing.js";
import type { CharacterDevice } from "./devices.js";
import { errnoNumbers } from "../core/errno.js";
import { bad } from "../core/err.js";
import { C_VFS_LOCK, THISTLE_THX_BUSY } from "../native/abi.js";
import { atomicStoreI32, compareExchangeI32 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleImageReserve, thistleImageRelease } from "../native/kernel.js";

export const withNativeLock = <T>(memory: ThistleMemory, lock: number, operation: () => T): T => {
  if (compareExchangeI32(memory, lock, 0, 1) !== 0) bad("EAGAIN", "canonical state is busy");
  try { return operation(); }
  finally { atomicStoreI32(memory, lock, 0); }
};

export const withVfsLock = <T>(memory: ThistleMemory, operation: () => T): T =>
  withNativeLock(memory, C_VFS_LOCK, operation);

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

/** Translate numeric ABI errors using the same table as the guest adapter. */
export const checkNative = (status: number): void => {
  if (status >= 0) return;
  for (const [code, number] of Object.entries(errnoNumbers)) {
    if (number === -status) {
      const known = code as keyof typeof errnoNumbers;
      bad(known, "canonical operation returned " + status);
    }
  }
  bad("EIO", "unknown canonical status " + status);
};

/** External transports live with their memory carrier; canonical state stays in its bytes. */
export interface HostMemory extends ThistleMemory {
  readonly transports: {
    backing: HostBacking | null;
    readonly devices: Map<number, { readonly identity: bigint; readonly device: CharacterDevice }>;
  };
}

/** Allocate one canonical carrier and its external transports. */
export const hostMemory = (bytes: number, shared = false): HostMemory => ({
  ...directMemory(bytes, shared),
  transports: { backing: null, devices: new Map<number, { readonly identity: bigint; readonly device: CharacterDevice }>() },
});
