import { bad } from "../core/err.js";
import { P_CWD_INODE, V_ATIME, V_CTIME, V_GID, V_KIND, V_MODE, V_MTIME, V_NLINK, V_SIZE, V_UID } from "../native/abi.js";
import { loadU32, loadU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { inodeAt, thistleVfsAccess, thistleVfsIdentity, thistleVfsReadData, thistleVfsResolve } from "../native/vfs.js";
import { withImage, withVfsLock, checkNative } from "./native-access.js";
import type { HostProcess } from "./process.js";
import { enc } from "../io/stream.js";
import { thistleVfsChmod, thistleVfsChown, thistleVfsUtime, thistleVfsCreate, thistleVfsLink, thistleVfsUnlink, thistleVfsRename, thistleVfsWrite } from "../native/vfs-edit.js";

export interface InodeMetadata {
  readonly ino: number;
  readonly kind: number;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly nlink: number;
  readonly size: bigint;
  readonly at: bigint;
  readonly mt: bigint;
  readonly ct: bigint;
}

/** Non-owning inode view with a token for detecting recycled native slots. */
export class HostInode {
  readonly identity: bigint;

  constructor(readonly memory: ThistleMemory, readonly ino: number, expectedIdentity: bigint | null = null) {
    if (!Number.isInteger(ino) || ino < 1 || ino > 0xffffffff) bad("EINVAL", "invalid inode number");
    this.identity = withVfsLock(memory, () => thistleVfsIdentity(memory, ino));
    if (this.identity === 0n || (expectedIdentity !== null && this.identity !== expectedIdentity)) bad("ENOENT", "missing or expired canonical inode");
  }

  /** Resolve the original path with the live process cwd and canonical traversal policy. */
  static resolve(process: HostProcess, path: string, followFinal = true): HostInode {
    const memory = process.memory, bytes = enc(path);
    if (bytes.length > 4096) bad("ENAMETOOLONG", path);
    const found = withImage(memory, Math.max(1, bytes.length), input => process.withFilesystem(record => {
      memory.bytes.set(bytes, input);
      const ino = thistleVfsResolve(memory, record, loadU32(memory, record + P_CWD_INODE), input, bytes.length, followFinal);
      checkNative(ino);
      return { ino, identity: thistleVfsIdentity(memory, ino) };
    }));
    return new HostInode(memory, found.ino, found.identity);
  }

  /** Encode one entry name, leaving name and permission decisions to native VFS. */
  private withName<T>(name: string, operation: (input: number, length: number) => T): T {
    const bytes = enc(name);
    if (bytes.length > 255) bad("ENAMETOOLONG", name);
    return withImage(this.memory, Math.max(1, bytes.length), input => {
      this.memory.bytes.set(bytes, input);
      return operation(input, bytes.length);
    });
  }

  create(process: HostProcess, name: string, kind: number, mode: number): HostInode {
    const found = this.withName(name, (input, length) => this.access(process, record => {
      const ino = thistleVfsCreate(this.memory, record, this.ino, input, length, kind, mode, BigInt(Date.now()));
      checkNative(ino);
      return { ino, identity: thistleVfsIdentity(this.memory, ino) };
    }));
    return new HostInode(this.memory, found.ino, found.identity);
  }

  link(process: HostProcess, name: string, target: HostInode): void {
    if (target.memory !== this.memory) bad("EINVAL", "filesystem instance mismatch");
    this.withName(name, (input, length) => this.access(process, record => {
      target.recordLocked();
      checkNative(thistleVfsLink(this.memory, record, this.ino, target.ino, input, length, BigInt(Date.now())));
    }));
  }

  unlink(process: HostProcess, name: string, directory = false): void {
    this.withName(name, (input, length) => this.access(process, record =>
      checkNative(thistleVfsUnlink(this.memory, record, this.ino, input, length, directory, BigInt(Date.now())))));
  }

  rename(process: HostProcess, name: string, destination: HostInode, newName: string): void {
    if (destination.memory !== this.memory) bad("EINVAL", "filesystem instance mismatch");
    const target = enc(newName);
    if (target.length > 255) bad("ENAMETOOLONG", newName);
    this.withName(name, (input, length) => withImage(this.memory, Math.max(1, target.length), output =>
      this.access(process, record => {
        destination.recordLocked();
        this.memory.bytes.set(target, output);
        checkNative(thistleVfsRename(this.memory, record, this.ino, input, length,
          destination.ino, output, target.length, BigInt(Date.now())));
      })));
  }

  /** Native arena payload write; host-backed files use the existing HostBacking carrier. */
  write(process: HostProcess, bytes: Uint8Array, offset = 0, replace = false): number {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 0x7fffffff) bad("EINVAL", "invalid inode write offset");
    return withImage(this.memory, Math.max(1, bytes.length), input => this.access(process, record => {
      this.memory.bytes.set(bytes, input);
      const written = thistleVfsWrite(this.memory, record, this.ino, input, bytes.length, offset, replace, BigInt(Date.now()));
      checkNative(written);
      return written;
    }));
  }

  chmod(process: HostProcess, mode: number): void {
    this.access(process, record => checkNative(thistleVfsChmod(this.memory, record, this.ino, mode, BigInt(Date.now()))));
  }

  chown(process: HostProcess, uid: number, gid: number): void {
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0 || uid >= 0xffffffff || gid >= 0xffffffff) bad("EINVAL", "invalid inode owner");
    this.access(process, record => checkNative(thistleVfsChown(this.memory, record, this.ino, uid, gid, BigInt(Date.now()))));
  }

  utime(process: HostProcess, atime: bigint, mtime: bigint): void {
    if (atime < 0n || mtime < 0n || atime > 0xffffffffffffffffn || mtime > 0xffffffffffffffffn) bad("EINVAL", "invalid inode timestamps");
    this.access(process, record => checkNative(thistleVfsUtime(this.memory, record, this.ino, atime, mtime, BigInt(Date.now()))));
  }

  private recordLocked(): number {
    if (thistleVfsIdentity(this.memory, this.ino) !== this.identity) bad("ENOENT", "canonical inode view expired");
    return inodeAt(this.memory, this.ino);
  }

  metadata(): InodeMetadata {
    return withVfsLock(this.memory, () => {
      const record = this.recordLocked();
      return { ino: this.ino, kind: loadU32(this.memory, record + V_KIND),
        mode: loadU32(this.memory, record + V_MODE), uid: loadU32(this.memory, record + V_UID),
        gid: loadU32(this.memory, record + V_GID), nlink: loadU32(this.memory, record + V_NLINK),
        size: loadU64(this.memory, record + V_SIZE), at: loadU64(this.memory, record + V_ATIME),
        mt: loadU64(this.memory, record + V_MTIME), ct: loadU64(this.memory, record + V_CTIME) };
    });
  }

  /** Validate the process and inode under native locks before invoking an adapter operation. */
  access<T>(process: HostProcess, operation: (record: number) => T): T {
    if (process.memory !== this.memory) bad("ESRCH", "filesystem process instance mismatch");
    return process.withFilesystem(record => { this.recordLocked(); return operation(record); });
  }

  read(process: HostProcess, offset: bigint, length: number): Uint8Array {
    if (offset < 0n || offset > 0xffffffffffffffffn || !Number.isSafeInteger(length) || length < 0 || length > 0x7fffffff) bad("EINVAL", "invalid inode read range");
    return withImage(this.memory, Math.max(1, length), input => this.access(process, record => {
      if (!thistleVfsAccess(this.memory, record, this.ino, 4)) bad("EACCES", "inode read denied");
      const count = thistleVfsReadData(this.memory, this.ino, offset, input, length);
      checkNative(count);
      return this.memory.bytes.slice(input, input + count);
    }));
  }
}
