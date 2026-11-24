# Native VFS mutation tests

`src/test/native-vfs-edit.test.ts` invokes the canonical TypeScript kernel
directly. Fixtures mount a real binary VFS image and establish a native process.

Tests cover data writes, permissions, hard-link identity, atomic ENOSPC, entry
reuse, non-empty directories, rename and directory-cycle rejection. An open
descriptor retains unlinked file data until final close; repeated creation and
deletion checks inode and arena reuse. These are correctness tests without
performance thresholds.

Host-kind descriptors keep an unlinked inode live until their final close.
