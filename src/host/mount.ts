import { bad } from "../core/err.js";
import { C_VFS_INODE_CAPACITY, C_VFS_DENTRY_CAPACITY, P_FSUID, THISTLE_VFS_BUSY } from "../native/abi.js";
import { loadU32 } from "../native/memory.js";
import { planHostThistleVfs, type VfsEntries } from "../native/vfs-image.js";
import { thistleLoadVfs, thistleVfsRoot, thistleVfsIdentity } from "../native/vfs.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";
import { HostBacking } from "./backing.js";
import { withImage, checkNative } from "./native-access.js";
import type { HostProcess } from "./process.js";

/** Restore one root image and its byte providers into the caller's canonical kernel. */
export const mountHostTree = (process: HostProcess, entries: VfsEntries, quota: number): HostBacking => {
  if (!Number.isSafeInteger(quota) || quota <= 0) bad("EINVAL", "invalid filesystem quota");
  const plan = planHostThistleVfs(entries), memory = process.memory;
  if (plan.residentBytes > BigInt(quota)) bad("ENOSPC", "restored payloads exceed the filesystem quota");
  return withImage(memory, plan.image.length, input => process.withFilesystem(record => {
    if (loadU32(memory, record + P_FSUID) !== 0) bad("EPERM", "root mount requires filesystem UID zero");
    const inodes = loadU32(memory, C_VFS_INODE_CAPACITY), dentries = loadU32(memory, C_VFS_DENTRY_CAPACITY);
    if (entries.some(entry => entry.id >= inodes) || entries.length - 1 > dentries) bad("ENOSPC", "root image exceeds native table capacity");
    memory.bytes.set(plan.image, input);
    const status = thistleLoadVfs(memory, input, plan.image.length);
    if (status === THISTLE_VFS_BUSY) bad("EBUSY", "root image has live filesystem references");
    if (status !== 0) bad("EIO", "canonical root image rejected with status " + status);
    checkNative(thistleVfsSetQuota(memory, BigInt(quota)));
    const ino = thistleVfsRoot(memory);
    const backing = new HostBacking(memory, { ino, identity: thistleVfsIdentity(memory, ino) });
    for (const entry of plan.files) {
      const payload = entry.data ?? entry.source ?? bad("EIO", "missing restored file payload");
      backing.installLocked(entry.id, record, input, payload);
    }
    return backing;
  }));
};
