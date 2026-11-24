/** Filesystem entry points consumed by the native instruction/syscall dispatcher. */
export { descriptorAt, releaseDescriptor, installDescriptor, descriptorAccessStatus, descriptorReadStatus, descriptorReadCount, thistleVfsReadDescriptor, thistleVfsSeekDescriptor,
  thistleVfsAccess,
  thistleVfsKind,
  thistleVfsReadScratch,
  thistleVfsLoaded,
  thistleVfsResolve,
  thistleVfsRoot, } from "./vfs.js";
export { thistleVfsWriteScratch, thistleVfsOpenPath } from "./vfs-edit.js";
