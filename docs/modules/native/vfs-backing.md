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

The descriptor operation selects materialisation (`0`), ordinary writing (`1`) or trusted restoration (`2`). Restoration requires filesystem UID zero and preserves the inode's image metadata while installing its resident bytes or lazy logical size. Version, quota and range checks apply to all three operations.

`thistleVfsCommitDescriptorBacking` publishes a materialisation or write using an open descriptor's rights, while holding the descriptor and VFS locks. Materialisation preserves its cursor; a successful write advances it from the canonical write offset by the transferred length. Trusted restoration is not available through descriptors.

Descriptor operation `3` replaces the complete resident payload, clears set-ID bits, updates timestamps and preserves the descriptor cursor. It requires write rights; size and resident length must match. Ordinary descriptor writes may promote an arena inode to a carrier without changing inode identity.

`thistleVfsMappingInode` validates a live mapping's read or shared-write rights. `thistleVfsCommitMappingBacking` publishes resident bytes through that authority, with the existing version and quota checks. It rejects a changed file size.

`thistleVfsMappingStale` compares the shared view revision with the live inode revision. `thistleVfsMappingRefreshed` acknowledges an exact revision after transport; a changed revision is rejected.
