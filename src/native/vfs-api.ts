/** Filesystem entry points consumed by the native instruction/syscall dispatcher. */
export { descriptorAt, releaseDescriptor, installDescriptor, copyDescriptor, freeDescriptor, thistleVfsIdentity, thistleVfsOpenInode, descriptorAccessStatus, descriptorReadStatus, descriptorReadCount, thistleVfsReadDescriptor, thistleVfsSeekDescriptor,
  thistleVfsAccess,
  thistleVfsKind,
  thistleVfsReadScratch,
  thistleVfsLoaded,
  thistleVfsResolve,
  thistleVfsRoot, } from "./vfs.js";
export { thistleVfsWriteScratch, thistleVfsOpenPath, thistleVfsWriteDescriptor } from "./vfs-edit.js";
