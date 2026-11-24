# vfs

Native VFS functions operate on inode/dentry tables in linear memory. `thistleLoadVfs` validates and mounts a filesystem image; `thistleVfsLoaded`, `thistleVfsRoot`, `thistleVfsInodeCount`, `thistleVfsDentryCount` report mount state. `thistleVfsKind`, `thistleVfsFileSize`, `thistleVfsMode`, `thistleVfsUid`, `thistleVfsGid`, `thistleVfsNlink` read inode metadata. `thistleVfsLookup`, `thistleVfsResolve` locate paths and `thistleVfsAccess` checks permissions. `thistleVfsReadData` and `thistleVfsReadScratch` copy file bytes. Inode numbers and addresses are not interchangeable.


## Internal mutation helpers

The following exports are shared with `vfs-edit.ts`. Callers hold the VFS lock
and supply validated canonical inode or dentry indices.

- `inodeAt` and `dentryAt` compute table addresses from the ABI layout.
- `allocateData` reserves arena bytes, reusing unreferenced gaps when needed.
  `growData` extends a payload in place when the following range is free,
  otherwise requesting another allocation. Failure returns `0xffffffff`.
- `hashBytes` hashes a name range. `validName` rejects empty names, slash,
  NUL, dot and dot-dot components. `sameName` compares stored hash, length
  and bytes; `findChild` returns the matching inode or zero.
- `parentOf` locates the canonical parent directory. `allowed` checks every
  requested permission bit against the process filesystem identity/groups.

`thistleVfsRelease` releases a nameless inode after its final canonical descriptor closes. `vfs-edit` re-exports the same function.

`thistleVfsResidentUsage` sums 128 bytes per live inode and each regular file's
resident payload. `residentFits` checks a byte replacement against the canonical
quota, with zero retaining the native arena-only policy. Host-backed payload
reads return EXDEV for explicit host transport.

`thistleVfsReadEntry` enumerates live entries of a directory under the VFS lock.
The cursor is a dentry slot; EOF returns zero. The reserved output contains
inode:u32, kind:u32, next-cursor:u32, name-length:u32, followed by UTF-8 bytes.
The result is the record length. Short buffers return ERANGE; directory read
permission is checked by the canonical `allowed` function.

`thistleVfsIdentity` returns the immutable incarnation token of a live inode, or zero for a missing inode. Content and metadata edits preserve identity; slot reuse and remount assign a new token.

Path resolution checks that the current component is a searchable directory before processing `.` or `..`. Symlink targets determine traversal before a following parent component.

`thistleLoadVfs` returns `THISTLE_VFS_BUSY` before mutation when open inode descriptors or non-root process working directories retain the current filesystem. A successful root replacement redirects root working directories to the new root inode. Callers hold the process, credential and VFS locks during host mounting.

`descriptorAt` locates a validated descriptor slot in a native process. `releaseDescriptor` clears the slot before checking final inode release. The exported close ABI, mounted RV64 close syscall and process reaper share this operation under descriptor and VFS locks.

`thistleVfsChdir` resolves from the live cwd inode, checks directory search access and updates the process record. `thistleVfsCwdPath` returns a NUL-terminated path in a reserved image, including the terminator in its length. `thistleVfsCwdHeld` detects live cwd references; directory removal or replacement returns `EBUSY` while referenced.

`freeDescriptor` locates a reusable slot. `installDescriptor` establishes its next incarnation and initial state; both native file open and standard host descriptor initialization use it. `releaseDescriptor` retains the incarnation counter while clearing live state.

`thistleVfsOpenInode` validates file or directory access, finds a descriptor and binds its inode. Append opens start at the current file size. Native read-only path opens use this same allocator and permission check.

`descriptorReadStatus` checks file kind and read flags. `thistleVfsReadDescriptor` copies arena bytes to a reserved image and advances the canonical offset. `thistleVfsSeekDescriptor` implements signed, checked seek and publishes the new offset only on success.

`arenaInodeStatus` checks payload inode kind and rejects host-backed storage
with `-EXDEV`; native arena reads and writes share this check.

`descriptorAccessStatus` checks an open regular file for any of the requested access bits. `descriptorReadCount` bounds a requested transfer by EOF. `descriptorWriteOffset` chooses the current EOF for append or the live cursor otherwise.

`allocateInodeDescriptor` installs a validated open inode without repeating permission checks, including for a newly created file whose mode may deny subsequent opens.
