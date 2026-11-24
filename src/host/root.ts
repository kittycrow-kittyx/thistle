import type { HostProcess } from "./process.js";
import type { HostBacking } from "./backing.js";
import { mountHostTree } from "./mount.js";
import { dumpHostTree } from "./snapshot.js";
import { withVfsLock } from "./native-access.js";
import { thistleVfsResidentUsage, thistleVfsInodeCount } from "../native/vfs.js";
import type { TreeEnt } from "../fs/tree.js";
import { registerDevice, type CharacterDevice } from "./devices.js";
import type { HostInode } from "./inode.js";

/** One mounted root and its byte-transport handle. Namespace state is native. */
export class RootVolume {
  backing: HostBacking;

  constructor(readonly authority: HostProcess, readonly cap: number) {
    const now = Date.now();
    const root: TreeEnt = { p: "/", k: "d", id: 1, mode: 0o755, uid: 0, gid: 0, at: now, mt: now, ct: now,
      data: null, sum: null, size: null, source: null, to: null };
    this.backing = mountHostTree(authority, [root], cap);
  }

  restore(entries: readonly TreeEnt[]): void { this.backing = mountHostTree(this.authority, entries, this.cap); }
  dump(): TreeEnt[] { return dumpHostTree(this.authority, this.backing); }
  used(): number { return withVfsLock(this.authority.memory, () => Number(thistleVfsResidentUsage(this.authority.memory))); }
  inodeCount(): number { return withVfsLock(this.authority.memory, () => thistleVfsInodeCount(this.authority.memory)); }
  device(inode: HostInode, transport: CharacterDevice): void { registerDevice(inode, this.authority, transport); }
}
