import { bad } from "../core/err.js";
import { FD_FLAGS, FD_IDENTITY, FD_KIND, FD_OFFSET, P_DESCRIPTOR_CAPACITY, THISTLE_FD_EMPTY, THISTLE_FD_HOST } from "../native/abi.js";
import { loadU32, loadU64, storeU32, storeU64 } from "../native/memory.js";
import { descriptorAt, freeDescriptor, installDescriptor, releaseDescriptor } from "../native/vfs.js";
import { checkNative, withVfsLock } from "./native-access.js";
import type { HostProcess } from "./process.js";

const slot = (process: HostProcess, record: number, number: number): number => {
  if (!Number.isInteger(number) || number < 0 || number >= loadU32(process.memory, record + P_DESCRIPTOR_CAPACITY)) bad("EBADF", "descriptor outside canonical table");
  return descriptorAt(process.memory, record, number);
};

const validOffset = (offset: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0) bad("EINVAL", "invalid descriptor offset");
};

/** A non-owning view of a host capability descriptor in canonical memory. */
export class HostDescriptor {
  private constructor(readonly process: HostProcess, readonly number: number, readonly identity: number) {}

  static next(process: HostProcess, minimum = 3): number {
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > 0xffffffff) bad("EINVAL", "invalid descriptor minimum");
    return process.withDescriptors(record => {
      const result = freeDescriptor(process.memory, record, minimum);
      checkNative(result);
      return result;
    });
  }

  static install(process: HostProcess, number: number, flags: number, offset: number): HostDescriptor {
    validOffset(offset);
    const memory = process.memory;
    const identity = process.withDescriptors(record => withVfsLock(memory, () => {
      const state = slot(process, record, number);
      const kind = loadU32(memory, state + FD_KIND);
      if (kind !== THISTLE_FD_EMPTY && kind !== THISTLE_FD_HOST) bad("EBUSY", "native file descriptor is occupied");
      checkNative(installDescriptor(memory, state, THISTLE_FD_HOST, flags & 15, 0));
      storeU64(memory, state + FD_OFFSET, BigInt(offset));
      return loadU32(memory, state + FD_IDENTITY);
    }));
    return new HostDescriptor(process, number, identity);
  }

  private access<T>(operation: (state: number) => T): T {
    const memory = this.process.memory;
    return this.process.withDescriptors(record => {
      const state = slot(this.process, record, this.number);
      if (loadU32(memory, state + FD_KIND) !== THISTLE_FD_HOST || loadU32(memory, state + FD_IDENTITY) !== this.identity) bad("EBADF", "descriptor incarnation expired");
      return operation(state);
    });
  }

  get flags(): number { return this.access(state => loadU32(this.process.memory, state + FD_FLAGS)); }

  setFlag(flag: number, enabled: boolean): void {
    this.access(state => {
      const memory = this.process.memory, flags = loadU32(memory, state + FD_FLAGS);
      storeU32(memory, state + FD_FLAGS, enabled ? flags | flag : flags & ~flag);
    });
  }

  get offset(): number {
    const offset = this.access(state => loadU64(this.process.memory, state + FD_OFFSET));
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) bad("EFBIG", "descriptor offset exceeds host integer range");
    return Number(offset);
  }

  set offset(value: number) {
    validOffset(value);
    this.access(state => storeU64(this.process.memory, state + FD_OFFSET, BigInt(value)));
  }

  close(): void {
    this.access(state => withVfsLock(this.process.memory, () => releaseDescriptor(this.process.memory, state)));
  }
}
