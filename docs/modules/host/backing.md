# Host byte carriers

`HostBacking` binds immutable byte arrays or lazy `RegSource` providers to
canonical inode handles. Its registry contains byte carriers and load promises.
Path lookup, ownership, file size, revisions and quota are read from the native
VFS. The class takes the VFS lock for snapshots and commits, releasing it before
awaiting a provider.

| Method | Contract |
| --- | --- |
| `install` | Root-only payload restoration preserving image mode, ownership and timestamps. |
| `setBytes` | Copy caller bytes and publish through the canonical permission/version/quota check. |
| `setSource` | Register a lazy provider with zero initial resident bytes. |
| `read` | Check canonical read access, copy resident data or materialise the provider. Reject stale completion. |
| `collect` | Reclaim carrier handles absent from canonical inodes; retain open unlinked files. |

Provider results are length-checked and copied before publication. The returned
read buffer is also a copy. Failed provider reads can be retried. This adapter
has not replaced the hosted filesystem node classes.

Operations take a `HostProcess` view. Provider completion checks process and inode identity before committing.

| Completion condition | Result |
| --- | --- |
| Reader reaped or its hart rebound | `ESRCH` |
| Inode unlinked and its slot recycled | `ENOENT` |
| Payload replaced during the read | `EAGAIN` |

The registry is bound to its root inode incarnation. A remount expires the registry; `collect` then discards its old byte carriers.

`installLocked` is the mount transaction entry: the caller supplies a validated process record and reserved input buffer while holding the process, credential and VFS locks. It shares the backing commit implementation with ordinary operations.

`snapshot` returns a copied resident carrier or its existing lazy source under live inode and process validation; arena-backed data returns null for the native reader. It does not fetch or publish lazy bytes.

`CarrierDescriptor` supplies a synchronous, incarnation-checked storage lease. `readDescriptor` copies resident data and advances the native cursor; `writeDescriptor` uses canonical append and quota policy. `materialiseDescriptor` releases locks during provider I/O and validates the descriptor and payload revision on completion. A lazy carrier returns `EAGAIN` until materialised. No pathname or current inode mode check replaces open-file authority.

A mount has one registered host byte carrier registry per root incarnation. `forDescriptor` selects it using the canonical inode's carrier handle; arena descriptors return null. Remounting replaces the registry binding without adding filesystem state.

`forWritableDescriptor` selects the mounted byte transport for a regular descriptor, including arena files. `replaceDescriptor` atomically replaces the whole resident payload without loading the discarded content or moving the cursor. `readView` uses the existing inode incarnation for provider completion.

`writeDescriptor` accepts an explicit whole-transfer mode for synchronous path appends; the ordinary descriptor contract remains bounded to 1 MiB.

`resizeDescriptor` changes the size using open write authority and the resident quota. Zero length drops lazy data without fetching it.
