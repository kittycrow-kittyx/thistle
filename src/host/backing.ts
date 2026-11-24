import { withVfsLock, withImage, checkNative } from "./native-access.js";
import { bad } from "../core/err.js";
import { SourceLoad } from "./bytes.js";
import { HostInode } from "./inode.js";
import type { HostProcess } from "./process.js";
import type { RegSource } from "./bytes.js";
import { C_VFS_INODE_CAPACITY } from "../native/abi.js";
import { loadU32, storeU32, storeU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleVfsAccess, thistleVfsFileSize, thistleVfsRoot, thistleVfsIdentity } from "../native/vfs.js";
import { thistleVfsBacking, thistleVfsBackingVersion, thistleVfsCommitBacking } from "../native/vfs-backing.js";

interface BackingUpdate {
  readonly inode: number;
  readonly payload: Payload;
  readonly size: number;
  readonly expected: bigint;
  readonly operation: 0 | 1 | 2;
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
  private readonly payloads = new Map<number, Payload>();
  private sequence = 1;
  private readonly root: { readonly ino: number; readonly identity: bigint };

  constructor(private readonly memory: ThistleMemory, root: { readonly ino: number; readonly identity: bigint } | null = null) {
    this.root = root === null ? withVfsLock(memory, () => {
      const ino = thistleVfsRoot(memory);
      return { ino, identity: thistleVfsIdentity(memory, ino) };
    }) : { ino: root.ino, identity: root.identity };
    if (this.root.identity === 0n) bad("ENOENT", "missing backing storage mount");
  }

  private mountedLocked(): boolean {
    return thistleVfsRoot(this.memory) === this.root.ino && thistleVfsIdentity(this.memory, this.root.ino) === this.root.identity;
  }

  private checkMountLocked(): void {
    if (!this.mountedLocked()) bad("ENOENT", "backing storage mount expired");
  }

  private commit(update: BackingUpdate, proc: number, input: number): void {
    const { inode, payload, size, expected, operation } = update;
    this.checkMountLocked();
    if (!Number.isSafeInteger(size) || size < 0) bad("EINVAL", "invalid backing size");
    if (this.sequence > 0xffffffff) bad("ENFILE", "host carrier handles exhausted");
    const handle = this.sequence++;
    storeU32(this.memory, input, handle); storeU32(this.memory, input + 4, operation);
    storeU64(this.memory, input + 8, BigInt(size));
    storeU64(this.memory, input + 16, BigInt(payload.bytes === null ? 0 : payload.bytes.byteLength));
    checkNative(thistleVfsCommitBacking(this.memory, proc, inode, expected, input, BigInt(Date.now())));
    this.payloads.set(handle, payload);
  }

  private publish(view: HostInode, process: HostProcess, payload: Payload, size: number, expected: bigint, operation: 0 | 1 | 2): void {
    withImage(this.memory, 24, input => view.access(process, proc => {
      this.commit({ inode: view.ino, payload, size, expected, operation }, proc, input);
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
    this.commit({ inode, payload, size, expected: thistleVfsBackingVersion(this.memory, inode), operation: 2 }, proc, input);
  }

  async read(inode: number, process: HostProcess): Promise<Uint8Array> {
    const view = new HostInode(this.memory, inode);
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
