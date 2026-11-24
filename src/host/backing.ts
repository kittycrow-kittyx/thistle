import { withVfsLock, withImage, checkNative } from "./native-access.js";
import { bad } from "../core/err.js";
import { SourceLoad } from "./bytes.js";
import type { RegSource } from "./bytes.js";
import { C_VFS_INODE_CAPACITY } from "../native/abi.js";
import { loadU32, storeU32, storeU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleVfsAccess, thistleVfsFileSize } from "../native/vfs.js";
import { thistleVfsBacking, thistleVfsBackingVersion, thistleVfsCommitBacking } from "../native/vfs-backing.js";

interface Payload {
  readonly bytes: Uint8Array | null;
  readonly source: SourceLoad | null;
}

/** Byte carriers only. Kernel memory owns all inode, permission and quota state. */
export class HostBacking {
  private readonly payloads = new Map<number, Payload>();
  private sequence = 1;

  constructor(private readonly memory: ThistleMemory) {}

  private publish(inode: number, proc: number, payload: Payload, size: number, expected: bigint, write: boolean): void {
    if (!Number.isSafeInteger(size) || size < 0) bad("EINVAL", "invalid backing size");
    if (this.sequence > 0xffffffff) bad("ENFILE", "host carrier handles exhausted");
    const handle = this.sequence++;
    withImage(this.memory, 24, input => {
      storeU32(this.memory, input, handle); storeU32(this.memory, input + 4, write ? 1 : 0);
      storeU64(this.memory, input + 8, BigInt(size));
      storeU64(this.memory, input + 16, BigInt(payload.bytes === null ? 0 : payload.bytes.byteLength));
      withVfsLock(this.memory, () => {
        checkNative(thistleVfsCommitBacking(this.memory, proc, inode, expected, input, BigInt(Date.now())));
        this.payloads.set(handle, payload);
        this.collectLocked();
      });
    });
  }

  setBytes(inode: number, proc: number, bytes: Uint8Array): void {
    const version = withVfsLock(this.memory, () => thistleVfsBackingVersion(this.memory, inode));
    this.publish(inode, proc, { bytes: bytes.slice(), source: null }, bytes.byteLength, version, true);
  }

  setSource(inode: number, proc: number, source: RegSource): void {
    if (source.size === 0) { this.setBytes(inode, proc, new Uint8Array()); return; }
    const version = withVfsLock(this.memory, () => thistleVfsBackingVersion(this.memory, inode));
    this.publish(inode, proc, { bytes: null, source: new SourceLoad(source) }, source.size, version, true);
  }

  async read(inode: number, proc: number): Promise<Uint8Array> {
    const snapshot = withVfsLock(this.memory, () => {
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
    this.publish(inode, proc, { bytes: bytes.slice(), source: null }, bytes.byteLength, version, false);
    return bytes.slice();
  }

  private collectLocked(): void {
    const retained = new Set<number>();
    const capacity = loadU32(this.memory, C_VFS_INODE_CAPACITY);
    for (let inode = 1; inode < capacity; inode++) retained.add(thistleVfsBacking(this.memory, inode));
    for (const handle of this.payloads.keys()) if (!retained.has(handle)) this.payloads.delete(handle);
  }

  /** Carrier reclamation follows canonical inode references, including open unlinks. */
  collect(): void { withVfsLock(this.memory, () => this.collectLocked()); }
}
