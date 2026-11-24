# Host byte carriers

`HostBacking` binds immutable byte arrays or lazy `RegSource` providers to
canonical inode handles. Its registry contains byte carriers and load promises.
Path lookup, ownership, file size, revisions and quota are read from the native
VFS. The class takes the VFS lock for snapshots and commits, releasing it before
awaiting a provider.

| Method | Contract |
| --- | --- |
| `setBytes` | Copy caller bytes and publish through the canonical permission/version/quota check. |
| `setSource` | Register a lazy provider with zero initial resident bytes. |
| `read` | Check canonical read access, copy resident data or materialise the provider. Reject stale completion. |
| `collect` | Reclaim carrier handles absent from canonical inodes; retain open unlinked files. |

Provider results are length-checked and copied before publication. The returned
read buffer is also a copy. Failed provider reads can be retried. This adapter
has not replaced the hosted filesystem node classes.

Operations take a `HostProcess` view. Lazy materialisation revalidates both the process PID binding and the inode incarnation after awaiting the provider. Reaping the reader or recycling the inode causes the old completion to fail before it commits storage metadata.
