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
