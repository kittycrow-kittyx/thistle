# Canonical VFS mutations

The caller holds the canonical VFS lock. Buffers must belong to the current
input reservation. Creation, writes, hard links, unlink, rename and metadata
changes return numeric errno values. Rename checks directory ancestry before
changing entries. An unlinked inode remains live while a canonical descriptor
references it, and the final close releases it.

Arena allocation reuses gaps left by removed entries and replaced payloads.
An allocation failure preserves the old file contents. Mutations advance the
canonical generation counter and mark the filesystem dirty for persistence.

These operations are the first consolidation increment. The hosted object VFS
has not yet been migrated and must not be deleted until its adapter and parity
tests pass. Public buffer marshalling and lock ownership remain integration
work before the new operations can replace the hosted entry points.

## Operations

| Export | Contract |
| --- | --- |
| `thistleVfsCreate` | Allocate a file, directory, symlink or character inode and attach its name. Return the inode or negative errno. |
| `thistleVfsWrite` | Replace or write bytes at an offset. Return bytes written or negative errno; ENOSPC retains old contents. |
| `thistleVfsLink` | Add a hard link to a non-directory inode and increment its link count. |
| `thistleVfsUnlink` | Remove the named entry, checking the requested directory kind and empty-directory condition. |
| `thistleVfsCanMove` | Return false when a proposed directory destination is the directory itself or a descendant. |
| `thistleVfsRename` | Validate both parents and replacement, then move the entry while retaining its inode identity. |
| `thistleVfsRelease` | Reclaim a nameless inode only after its final descriptor reference is gone. |
| `thistleVfsChmod` | Change mode as root or the inode owner. |
| `thistleVfsChown` | Change ownership as root and clear set-ID mode bits. |
| `thistleVfsUtime` | Set access/modification times as root or owner; update change time from the supplied clock value. |

Removing or replacing a directory held as a process cwd returns `EBUSY`. Renaming a referenced directory retains its inode and updates the path observed by the process.

`thistleVfsWriteDescriptor` writes arena bytes through a live writable descriptor. Append selects the current inode size under lock. Access is retained after unlink or permission changes, and the descriptor offset advances only on success.

`thistleVfsWriteScratch` accepts a bounded transfer from the canonical scratch region while the VFS lock is held, sharing write policy with `thistleVfsWriteDescriptor`.

`thistleVfsOpenPath` resolves the original path and validates Linux access, creation, exclusive, truncate, append, directory, no-follow and close-on-exec flags. Creation applies the canonical umask and checks slot capacity before mutation. Truncating an existing writable file discards its payload and invalidates its revision without loading a lazy provider. Dangling final symlink creation follows the target when allowed.
