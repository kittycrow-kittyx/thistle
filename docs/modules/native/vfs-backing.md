# Canonical backing-storage metadata

All calls require the VFS lock. Host handles identify byte carriers, with
inode identity, sizes, quota and permissions retained in canonical memory.

| Export | Contract |
| --- | --- |
| `thistleVfsSetQuota` | Set a positive resident-byte limit within the exact host integer range. Reject a limit below current usage. |
| `thistleVfsBacking` | Return the host carrier handle, or zero for arena storage or a missing regular inode. |
| `thistleVfsBackingVersion` | Return the payload revision used for async completion checks. |
| `thistleVfsCommitBacking` | Validate the reserved descriptor, permission, expected version and quota, then publish the handle and metadata. |

The 24-byte input descriptor contains handle:u32, write:u32, logical-size:u64
and resident-bytes:u64. Write zero materialises existing content and preserves
size, timestamps and set-ID bits. Write one replaces content and clears set-ID
bits. Logical size may exceed resident storage. Quota includes 128 bytes per
live inode and regular-file resident bytes; open unlinked inodes remain charged
until final close. Byte transport and immutable payload carriers belong to the
host adapter.

| Boundary result | Meaning |
| --- | --- |
| EXDEV | Arena read/write requested for a host-backed inode. |
| EAGAIN | Payload revision changed, including after inode reuse. |
