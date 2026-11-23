# Canonical VFS mutations

`src/native/vfs-edit.ts` adds mutations to the existing canonical inode,
directory-entry and payload arena. It shares lookup, permissions, allocation
and ABI layouts with `vfs.ts`; it does not maintain a second filesystem.

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
