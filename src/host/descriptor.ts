import { bad } from "../core/err.js";
import { HostBacking } from "./backing.js";
import { C_CREDENTIAL_LOCK, FD_FLAGS, FD_IDENTITY, FD_INODE, FD_KIND, FD_OFFSET, P_DESCRIPTOR_CAPACITY, THISTLE_FD_EMPTY, THISTLE_FD_HOST } from "../native/abi.js";
import { loadU32, loadU64, storeU32, storeU64 } from "../native/memory.js";
import { descriptorAt, freeDescriptor, installDescriptor, releaseDescriptor, thistleVfsIdentity, thistleVfsOpenInode, thistleVfsReadDescriptor, thistleVfsSeekDescriptor } from "../native/vfs.js";
import { checkNative, withVfsLock, withNativeLock, withImage } from "./native-access.js";
import type { HostProcess } from "./process.js";
import type { HostInode } from "./inode.js";
import { thistleVfsWriteDescriptor } from "../native/vfs-edit.js";

const slot = (process: HostProcess, record: number, number: number): number => {
  if (!Number.isInteger(number) || number < 0 || number >= loadU32(process.memory, record + P_DESCRIPTOR_CAPACITY)) bad("EBADF", "descriptor outside canonical table");
  return descriptorAt(process.memory, record, number);
};

const validOffset = (offset: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0) bad("EINVAL", "invalid descriptor offset");
};

/** Non-owning descriptor view in canonical memory, including inode and host capability slots. */
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

  static find(process: HostProcess, number: number): HostDescriptor | null {
    if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) return null;
    const memory = process.memory;
    return process.withDescriptors(record => {
      if (number >= loadU32(memory, record + P_DESCRIPTOR_CAPACITY)) return null;
      const state = descriptorAt(memory, record, number);
      if (loadU32(memory, state + FD_KIND) === THISTLE_FD_EMPTY) return null;
      return new HostDescriptor(process, number, loadU32(memory, state + FD_IDENTITY));
    });
  }

  static attach(process: HostProcess, number: number): HostDescriptor {
    return HostDescriptor.find(process, number) ?? bad("EBADF", "descriptor is closed");
  }

  static active(process: HostProcess): HostDescriptor[] {
    const memory = process.memory, result: HostDescriptor[] = [];
    process.withDescriptors(record => {
      const count = loadU32(memory, record + P_DESCRIPTOR_CAPACITY);
      for (let number = 0; number < count; number++) {
        const state = descriptorAt(memory, record, number);
        if (loadU32(memory, state + FD_KIND) === THISTLE_FD_EMPTY) continue;
        result.push(new HostDescriptor(process, number, loadU32(memory, state + FD_IDENTITY)));
      }
    });
    return result;
  }

  static open(process: HostProcess, inode: HostInode, flags: number, minimum = 3): HostDescriptor {
    const memory = process.memory;
    if (inode.memory !== memory) bad("EINVAL", "descriptor filesystem instance mismatch");
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > 0xffffffff) bad("EINVAL", "invalid descriptor minimum");
    if (!Number.isInteger(flags) || flags < 0 || flags > 15) bad("EINVAL", "invalid descriptor flags");
    return process.withDescriptors(record => withNativeLock(memory, C_CREDENTIAL_LOCK, () => withVfsLock(memory, () => {
      if (thistleVfsIdentity(memory, inode.ino) !== inode.identity) bad("ENOENT", "inode view expired");
      const number = thistleVfsOpenInode(memory, record, inode.ino, flags, minimum);
      checkNative(number);
      return new HostDescriptor(process, number, loadU32(memory, descriptorAt(memory, record, number) + FD_IDENTITY));
    })));
  }

  private access<T>(operation: (state: number) => T): T {
    const memory = this.process.memory;
    return this.process.withDescriptors(record => {
      const state = slot(this.process, record, this.number);
      if (loadU32(memory, state + FD_KIND) === THISTLE_FD_EMPTY || loadU32(memory, state + FD_IDENTITY) !== this.identity) bad("EBADF", "descriptor incarnation expired");
      return operation(state);
    });
  }

  /** Storage transports borrow a live descriptor and the VFS lock synchronously. */
  withStorage<T>(operation: (state: number) => T): T {
    const memory = this.process.memory;
    return this.access(state => withVfsLock(memory, () => operation(state)));
  }

  get kind(): number { return this.access(state => loadU32(this.process.memory, state + FD_KIND)); }
  get inode(): number { return this.access(state => loadU32(this.process.memory, state + FD_INODE)); }

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

  readFile(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) bad("EINVAL", "invalid descriptor read length");
    const backing = HostBacking.forDescriptor(this);
    if (backing !== null) return backing.readDescriptor(this, length);
    const memory = this.process.memory, amount = Math.min(length, 1048576);
    return withImage(memory, Math.max(1, amount), input => this.access(state => withVfsLock(memory, () => {
      const count = thistleVfsReadDescriptor(memory, state, input, amount);
      checkNative(count);
      return memory.bytes.slice(input, input + count);
    })));
  }

  writeFile(bytes: Uint8Array): number {
    const backing = HostBacking.forDescriptor(this);
    if (backing !== null) return backing.writeDescriptor(this, bytes);
    const memory = this.process.memory, amount = Math.min(bytes.length, 1048576);
    return withImage(memory, Math.max(1, amount), input => this.access(state => withVfsLock(memory, () => {
      memory.bytes.set(bytes.subarray(0, amount), input);
      const count = thistleVfsWriteDescriptor(memory, state, input, amount, BigInt(Date.now()));
      checkNative(count);
      return count;
    })));
  }

  /** Await byte transport before synchronous file I/O, without changing the cursor. */
  async materialiseFile(): Promise<void> {
    const backing = HostBacking.forDescriptor(this);
    if (backing !== null) await backing.materialiseDescriptor(this);
  }

  seekFile(offset: number, whence: number): number {
    if (!Number.isSafeInteger(offset) || !Number.isInteger(whence) || whence < 0 || whence > 2) bad("EINVAL", "invalid descriptor seek");
    const memory = this.process.memory;
    return this.access(state => withVfsLock(memory, () => {
      const previous = loadU64(memory, state + FD_OFFSET);
      const result = thistleVfsSeekDescriptor(memory, state, BigInt(offset), whence);
      if (result < 0n) checkNative(Number(result));
      if (result <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(result);
      storeU64(memory, state + FD_OFFSET, previous);
      return bad("EFBIG", "descriptor offset exceeds host integer range");
    }));
  }

  close(): void {
    this.access(state => withVfsLock(this.process.memory, () => releaseDescriptor(this.process.memory, state)));
  }
}
