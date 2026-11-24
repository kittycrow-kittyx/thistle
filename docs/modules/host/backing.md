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
