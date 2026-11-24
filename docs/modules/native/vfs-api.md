# Native filesystem surface

Re-exports the existing canonical VFS lookup, descriptor, scratch I/O and open operations used by the native syscall dispatcher. No state or policy is defined here.

Exports: `descriptorAt`, `releaseDescriptor`, `installDescriptor`, `descriptorAccessStatus`, `descriptorReadStatus`, `descriptorReadCount`, `thistleVfsReadDescriptor`, `thistleVfsSeekDescriptor`, `thistleVfsAccess`, `thistleVfsKind`, `thistleVfsReadScratch`, `thistleVfsLoaded`, `thistleVfsResolve`, `thistleVfsRoot`, `thistleVfsWriteScratch`, `thistleVfsOpenPath`, `freeDescriptor`, `thistleVfsIdentity`, `thistleVfsOpenInode`, `thistleVfsWriteDescriptor`, `copyDescriptor`.
