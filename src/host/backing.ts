import { withVfsLock, withImage, checkNative } from "./native-access.js";
import { bad } from "../core/err.js";
import { SourceLoad } from "./bytes.js";
import { HostInode } from "./inode.js";
import type { HostProcess } from "./process.js";
import type { RegSource } from "./bytes.js";
import { C_VFS_INODE_CAPACITY, FD_INODE, FD_KIND, FD_OFFSET, THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_FD_FILE, V_DATA, V_RESIDENT, P_MAP_TABLE, P_MAP_COUNT, THISTLE_MAP_STRIDE, M_INODE, M_ADDRESS, M_END, M_FLAGS, M_FILE_RIGHTS, M_FILE_OFFSET, M_PROTECTION } from "../native/abi.js";
import { loadU32, loadU64, storeU32, storeU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleVfsAccess, thistleVfsFileSize, thistleVfsRoot, thistleVfsIdentity, descriptorAccessStatus, descriptorReadCount, descriptorWriteOffset, residentFits, inodeAt, arenaInodeStatus } from "../native/vfs.js";
import { thistleVfsBacking, thistleVfsBackingVersion, thistleVfsCommitBacking, thistleVfsCommitDescriptorBacking, thistleVfsMappingInode, thistleVfsCommitMappingBacking } from "../native/vfs-backing.js";

/** Live descriptor capability; the callback holds its lifetime and VFS locks. */
export interface CarrierDescriptor {
  readonly process: HostProcess;
  withStorage<T>(operation: (state: number) => T): T;
}

type BackingAuthority = { readonly record: number; readonly length: number | null } |
  { readonly process: number; readonly mapping: number };

export interface MappedRange {
  readonly index: number;
  readonly at: bigint;
  readonly end: bigint;
  readonly inode: number;
  readonly prot: number;
  readonly writable: boolean;
}

/** A transient view of the native map table; no host mapping registry is retained. */
export const mappedRanges = (process: HostProcess): MappedRange[] => {
  const memory = process.memory;
  return process.withDescriptors(record => {
    const ranges: MappedRange[] = [], table = loadU32(memory, record + P_MAP_TABLE);
    const count = loadU32(memory, record + P_MAP_COUNT);
    for (let index = 0; index < count; index++) {
      const state = table + index * THISTLE_MAP_STRIDE, inode = loadU32(memory, state + M_INODE);
      if (inode === 0) continue;
      ranges.push({ index, inode, at: loadU64(memory, state + M_ADDRESS), end: loadU64(memory, state + M_END),
        prot: loadU32(memory, state + M_PROTECTION), writable: (loadU32(memory, state + M_FLAGS) & 3) === 1 &&
          (loadU32(memory, state + M_FILE_RIGHTS) & THISTLE_FD_WRITE) !== 0 });
    }
    return ranges;
  });
};

interface BackingUpdate {
  readonly inode: number;
  readonly payload: Payload;
  readonly size: number;
  readonly expected: bigint;
  readonly operation: 0 | 1 | 2 | 3;
}

const restoredPayload = (source: RegSource | Uint8Array): { payload: Payload; size: number } => {
  if (source instanceof Uint8Array) return { payload: { bytes: source.slice(), source: null }, size: source.byteLength };
  const payload = source.size === 0 ? { bytes: new Uint8Array(), source: null }
    : { bytes: null, source: new SourceLoad(source) };
  return { payload, size: source.size };
};

interface Payload {
  readonly bytes: Uint8Array | null;
  readonly source: SourceLoad | null;
}

/** Byte carriers only. Kernel memory owns all inode, permission and quota state. */
export class HostBacking {
  private static readonly mounts = new WeakMap<ThistleMemory, HostBacking>();
  private readonly payloads = new Map<number, Payload>();
  private sequence = 1;
  private readonly root: { readonly ino: number; readonly identity: bigint };

  constructor(private readonly memory: ThistleMemory, root: { readonly ino: number; readonly identity: bigint } | null = null) {
    this.root = root === null ? withVfsLock(memory, () => {
      const ino = thistleVfsRoot(memory);
      return { ino, identity: thistleVfsIdentity(memory, ino) };
    }) : { ino: root.ino, identity: root.identity };
    if (this.root.identity === 0n) bad("ENOENT", "missing backing storage mount");
    const previous = HostBacking.mounts.get(memory) ?? null;
    if (previous !== null && previous.root.ino === this.root.ino && previous.root.identity === this.root.identity) bad("EBUSY", "mount already has a byte carrier registry");
    HostBacking.mounts.set(memory, this);
  }

  /** Find the host transport only when the live descriptor refers to a carrier. */
  static forDescriptor(descriptor: CarrierDescriptor): HostBacking | null {
    const memory = descriptor.process.memory;
    return descriptor.withStorage(state => {
      if (thistleVfsBacking(memory, loadU32(memory, state + FD_INODE)) === 0) return null;
      const backing = HostBacking.mounts.get(memory) ?? bad("EIO", "mount has no byte carrier registry");
      backing.checkMountLocked();
      return backing;
    });
  }

  /** A mounted host can promote arena files to byte carriers when they grow. */
  static forWritableDescriptor(descriptor: CarrierDescriptor): HostBacking | null {
    const memory = descriptor.process.memory;
    return descriptor.withStorage(state => {
      if (loadU32(memory, state + FD_KIND) !== THISTLE_FD_FILE) return null;
      const backing = HostBacking.mounts.get(memory) ?? null;
      if (backing !== null) backing.checkMountLocked();
      return backing;
    });
  }

  private mountedLocked(): boolean {
    return thistleVfsRoot(this.memory) === this.root.ino && thistleVfsIdentity(this.memory, this.root.ino) === this.root.identity;
  }

  private checkMountLocked(): void {
    if (!this.mountedLocked()) bad("ENOENT", "backing storage mount expired");
  }

  private commit(update: BackingUpdate, authority: BackingAuthority, input: number): void {
    const { inode, payload, size, expected, operation } = update;
    this.checkMountLocked();
    if (!Number.isSafeInteger(size) || size < 0) bad("EINVAL", "invalid backing size");
    if (this.sequence > 0xffffffff) bad("ENFILE", "host carrier handles exhausted");
    const handle = this.sequence++;
    storeU32(this.memory, input, handle); storeU32(this.memory, input + 4, operation);
    storeU64(this.memory, input + 8, BigInt(size));
    storeU64(this.memory, input + 16, BigInt(payload.bytes === null ? 0 : payload.bytes.byteLength));
    const now = BigInt(Date.now());
    const status = "mapping" in authority
      ? thistleVfsCommitMappingBacking(this.memory, authority.process, authority.mapping, expected, input, now)
      : authority.length === null
        ? thistleVfsCommitBacking(this.memory, authority.record, inode, expected, input, now)
        : thistleVfsCommitDescriptorBacking(this.memory, authority.record, expected, input, authority.length, now);
    checkNative(status);
    this.payloads.set(handle, payload);
  }

  private publish(view: HostInode, process: HostProcess, payload: Payload, size: number, expected: bigint, operation: 0 | 1 | 2): void {
    withImage(this.memory, 24, input => view.access(process, proc => {
      this.commit({ inode: view.ino, payload, size, expected, operation }, { record: proc, length: null }, input);
      this.collectLocked();
    }));
  }

  private replace(inode: number, process: HostProcess, payload: Payload, size: number, operation: 1 | 2): void {
    const view = new HostInode(this.memory, inode);
    const version = view.access(process, () => { this.checkMountLocked(); return thistleVfsBackingVersion(this.memory, inode); });
    this.publish(view, process, payload, size, version, operation);
  }

  setBytes(inode: number, process: HostProcess, bytes: Uint8Array): void {
    this.replace(inode, process, { bytes: bytes.slice(), source: null }, bytes.byteLength, 1);
  }

  setSource(inode: number, process: HostProcess, source: RegSource): void {
    if (source.size === 0) { this.setBytes(inode, process, new Uint8Array()); return; }
    this.replace(inode, process, { bytes: null, source: new SourceLoad(source) }, source.size, 1);
  }

  /** Root-only image loader operation preserving the inode's restored mode and timestamps. */
  install(inode: number, process: HostProcess, source: RegSource | Uint8Array): void {
    const { payload, size } = restoredPayload(source);
    this.replace(inode, process, payload, size, 2);
  }

  /** Mount transaction only: caller holds process, credential and VFS locks and a 24-byte input lease. */
  installLocked(inode: number, proc: number, input: number, source: RegSource | Uint8Array): void {
    const { payload, size } = restoredPayload(source);
    this.commit({ inode, payload, size, expected: thistleVfsBackingVersion(this.memory, inode), operation: 2 }, { record: proc, length: null }, input);
  }

  /** Export the existing carrier without loading a lazy provider or changing inode state. */
  snapshot(view: HostInode, process: HostProcess): Uint8Array | RegSource | null {
    if (view.memory !== this.memory) bad("EINVAL", "backing snapshot instance mismatch");
    return view.access(process, proc => {
      this.checkMountLocked();
      if (!thistleVfsAccess(this.memory, proc, view.ino, 4)) bad("EACCES", "backing read denied");
      const handle = thistleVfsBacking(this.memory, view.ino);
      if (handle === 0) return null;
      const payload = this.payloads.get(handle) ?? bad("EIO", "missing host byte carrier");
      if (payload.bytes !== null) return payload.bytes.slice();
      const source = payload.source ?? bad("EIO", "missing lazy byte source");
      return source.source;
    });
  }

  async read(inode: number, process: HostProcess): Promise<Uint8Array> {
    return this.readView(new HostInode(this.memory, inode), process);
  }

  /** Load a carrier through the caller's already resolved inode incarnation. */
  async readView(view: HostInode, process: HostProcess): Promise<Uint8Array> {
    const inode = view.ino;
    const snapshot = view.access(process, proc => {
      this.checkMountLocked();
      if (!thistleVfsAccess(this.memory, proc, inode, 4)) bad("EACCES", "backing read denied");
      const handle = thistleVfsBacking(this.memory, inode);
      const payload = this.payloads.get(handle) ?? bad("EIO", "missing host byte carrier");
      return { payload, version: thistleVfsBackingVersion(this.memory, inode), size: thistleVfsFileSize(this.memory, inode) };
    });
    const { payload, version, size } = snapshot;
    if (payload.bytes !== null) return payload.bytes.slice();
    const source = payload.source ?? bad("EIO", "missing lazy byte source");
    const bytes = await source.read();
    if (BigInt(bytes.byteLength) !== size) bad("EIO", "lazy payload length mismatch");
    this.publish(view, process, { bytes: bytes.slice(), source: null }, bytes.byteLength, version, 0);
    return bytes.slice();
  }

  private descriptorStorage<T>(descriptor: CarrierDescriptor, rights: number, operation: (state: number, inode: number, payload: Payload) => T): T {
    if (descriptor.process.memory !== this.memory) bad("EINVAL", "descriptor backing instance mismatch");
    return descriptor.withStorage(state => {
      this.checkMountLocked();
      checkNative(descriptorAccessStatus(this.memory, state, rights));
      const inode = loadU32(this.memory, state + FD_INODE);
      const handle = thistleVfsBacking(this.memory, inode);
      if (handle === 0) bad("EXDEV", "descriptor uses arena storage");
      const payload = this.payloads.get(handle) ?? bad("EIO", "missing host byte carrier");
      return operation(state, inode, payload);
    });
  }

  /** Read resident bytes through the open descriptor, advancing its native offset. */
  readDescriptor(descriptor: CarrierDescriptor, length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) bad("EINVAL", "invalid descriptor read length");
    return this.descriptorStorage(descriptor, THISTLE_FD_READ, (state, _inode, payload) => {
      const amount = descriptorReadCount(this.memory, state, Math.min(length, 1048576));
      if (amount === 0) return new Uint8Array();
      const bytes = payload.bytes ?? bad("EAGAIN", "lazy descriptor requires materialisation");
      const offset = loadU64(this.memory, state + FD_OFFSET);
      const end = offset + BigInt(amount);
      if (end > BigInt(bytes.length)) bad("EIO", "carrier size disagrees with inode");
      const result = bytes.slice(Number(offset), Number(end));
      storeU64(this.memory, state + FD_OFFSET, end);
      return result;
    });
  }

  /** Resolve deferred carrier bytes without changing the open descriptor cursor. */
  async materialiseDescriptor(descriptor: CarrierDescriptor): Promise<void> {
    const snapshot = this.descriptorStorage(descriptor, THISTLE_FD_READ | THISTLE_FD_WRITE, (_state, inode, payload) => ({
      inode, version: thistleVfsBackingVersion(this.memory, inode), payload,
      size: thistleVfsFileSize(this.memory, inode),
    }));
    if (snapshot.payload.bytes !== null) return;
    const source = snapshot.payload.source ?? bad("EIO", "missing lazy byte source");
    const bytes = await source.read();
    if (BigInt(bytes.length) !== snapshot.size) bad("EIO", "lazy payload length mismatch");
    withImage(this.memory, 24, input => this.descriptorStorage(descriptor, THISTLE_FD_READ | THISTLE_FD_WRITE, (state, inode, _payload) => {
      if (inode !== snapshot.inode) bad("EBADF", "descriptor inode changed");
      this.commit({ inode, payload: { bytes: bytes.slice(), source: null }, size: bytes.length,
        expected: snapshot.version, operation: 0 }, { record: state, length: 0 }, input);
      this.collectLocked();
    }));
  }

  private residentBytes(inode: number): Uint8Array {
    const handle = thistleVfsBacking(this.memory, inode);
    if (handle !== 0) {
      const payload = this.payloads.get(handle) ?? bad("EIO", "missing host byte carrier");
      return payload.bytes ?? bad("EAGAIN", "lazy descriptor requires materialisation");
    }
    checkNative(arenaInodeStatus(this.memory, inode));
    const size = Number(thistleVfsFileSize(this.memory, inode));
    const at = loadU32(this.memory, inodeAt(this.memory, inode) + V_DATA);
    if (size > this.memory.bytes.length - at) bad("EIO", "invalid arena payload range");
    return this.memory.bytes.subarray(at, at + size);
  }

  private withWritable<T>(descriptor: CarrierDescriptor, operation: (state: number, inode: number) => T): T {
    if (descriptor.process.memory !== this.memory) bad("EINVAL", "descriptor backing instance mismatch");
    return descriptor.withStorage(state => {
      this.checkMountLocked();
      checkNative(descriptorAccessStatus(this.memory, state, THISTLE_FD_WRITE));
      return operation(state, loadU32(this.memory, state + FD_INODE));
    });
  }

  /** Replace bytes via open rights, preserving the cursor and failing before publication on quota errors. */
  replaceDescriptor(descriptor: CarrierDescriptor, bytes: Uint8Array): void {
    withImage(this.memory, 24, input => this.withWritable(descriptor, (state, inode) => {
      this.commit({ inode, payload: { bytes: bytes.slice(), source: null }, size: bytes.length,
        expected: thistleVfsBackingVersion(this.memory, inode), operation: 3 }, { record: state, length: 0 }, input);
      this.collectLocked();
    }));
  }

  /** Resize through open write authority; a zero size discards a deferred provider. */
  resizeDescriptor(descriptor: CarrierDescriptor, size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) bad("EINVAL", "invalid file size");
    withImage(this.memory, 24, input => this.withWritable(descriptor, (state, inode) => {
      const old = size === 0 ? new Uint8Array() : this.residentBytes(inode);
      const record = inodeAt(this.memory, inode);
      const resident = thistleVfsBacking(this.memory, inode) === 0 ? thistleVfsFileSize(this.memory, inode) : loadU64(this.memory, record + V_RESIDENT);
      if (!residentFits(this.memory, resident, BigInt(size))) bad("ENOSPC", "carrier exceeds filesystem quota");
      const bytes = new Uint8Array(size);
      bytes.set(old.subarray(0, size));
      this.commit({ inode, payload: { bytes, source: null }, size,
        expected: thistleVfsBackingVersion(this.memory, inode), operation: 3 }, { record: state, length: 0 }, input);
      this.collectLocked();
    }));
  }

  /** Write resident carrier bytes using canonical append/offset and quota policy. */
  writeDescriptor(descriptor: CarrierDescriptor, bytes: Uint8Array, whole = false): number {
    if (bytes.length > 0x7fffffff) bad("EFBIG", "host transfer exceeds native length range");
    return withImage(this.memory, 24, input => this.withWritable(descriptor, (state, inode) => {
      const amount = whole ? bytes.length : Math.min(bytes.length, 1048576);
      if (amount === 0) return 0;
      const previous = this.residentBytes(inode);
      const offset = descriptorWriteOffset(this.memory, state), end = offset + BigInt(amount);
      if (end > BigInt(Number.MAX_SAFE_INTEGER)) bad("EFBIG", "carrier size exceeds host integer range");
      const size = Math.max(previous.length, Number(end));
      if (!residentFits(this.memory, BigInt(previous.length), BigInt(size))) bad("ENOSPC", "carrier exceeds filesystem quota");
      const replacement = new Uint8Array(size);
      replacement.set(previous);
      replacement.set(bytes.subarray(0, amount), Number(offset));
      this.commit({ inode, payload: { bytes: replacement, source: null }, size,
        expected: thistleVfsBackingVersion(this.memory, inode), operation: 1 }, { record: state, length: amount }, input);
      this.collectLocked();
      return amount;
    }));
  }

  /** Select the byte registry associated with the process's canonical mount. */
  static forMapping(process: HostProcess): HostBacking {
    return HostBacking.mounts.get(process.memory) ?? bad("EIO", "mount has no byte carrier registry");
  }

  private mappingStorage<T>(process: HostProcess, index: number, write: boolean,
    operation: (record: number, state: number, inode: number) => T): T {
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) bad("EINVAL", "invalid mapping index");
    if (process.memory !== this.memory) bad("EINVAL", "mapping mount mismatch");
    const memory = this.memory;
    return process.withDescriptors(record => withVfsLock(memory, () => {
      const inode = thistleVfsMappingInode(memory, record, index, write);
      checkNative(inode);
      this.checkMountLocked();
      return operation(record, loadU32(memory, record + P_MAP_TABLE) + index * THISTLE_MAP_STRIDE, inode);
    }));
  }

  private mappingOffset(state: number, address: bigint, length: number): bigint {
    const start = loadU64(this.memory, state + M_ADDRESS), end = loadU64(this.memory, state + M_END);
    if (!Number.isSafeInteger(length) || length < 0 || address < start || address > end ||
        BigInt(length) > end - address) bad("EINVAL", "transfer outside retained mapping");
    return loadU64(this.memory, state + M_FILE_OFFSET) + address - start;
  }

  /** Copy resident bytes through a canonical mapping without moving any descriptor cursor. */
  readMapping(process: HostProcess, index: number, address: bigint, length: number): Uint8Array {
    return this.mappingStorage(process, index, false, (_record, state, inode) => {
      const offset = this.mappingOffset(state, address, length), bytes = this.residentBytes(inode);
      if (offset >= BigInt(bytes.length)) return new Uint8Array();
      return bytes.slice(Number(offset), Number(offset) + length);
    });
  }

  /** Flush a shared range through retained open authority, bounded by the current EOF. */
  writeMapping(process: HostProcess, index: number, address: bigint, bytes: Uint8Array): void {
    withImage(this.memory, 24, input => this.mappingStorage(process, index, true, (record, state, inode) => {
      const offset = this.mappingOffset(state, address, bytes.length), previous = this.residentBytes(inode);
      if (offset >= BigInt(previous.length) || bytes.length === 0) return;
      const start = Number(offset), amount = Math.min(bytes.length, previous.length - start);
      const part = bytes.subarray(0, amount);
      if (part.every((byte, i) => byte === (previous[start + i] ?? -1))) return;
      const replacement = previous.slice();
      replacement.set(part, start);
      this.commit({ inode, payload: { bytes: replacement, source: null }, size: replacement.length,
        expected: thistleVfsBackingVersion(this.memory, inode), operation: 3 }, { process: record, mapping: index }, input);
      this.collectLocked();
    }));
  }

  private collectLocked(): void {
    const retained = new Set<number>();
    const capacity = loadU32(this.memory, C_VFS_INODE_CAPACITY);
    for (let inode = 1; inode < capacity; inode++) retained.add(thistleVfsBacking(this.memory, inode));
    for (const handle of this.payloads.keys()) if (!retained.has(handle)) this.payloads.delete(handle);
  }

  /** Carrier reclamation follows canonical inode references, including open unlinks. */
  collect(): void { withVfsLock(this.memory, () => {
    if (!this.mountedLocked()) { this.payloads.clear(); return; }
    this.collectLocked();
  }); }
}
