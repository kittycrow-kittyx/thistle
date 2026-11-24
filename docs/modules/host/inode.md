# inode

`HostInode` holds a native inode number and its incarnation token. Metadata and arena reads consult canonical memory. Writes, renames and hard links preserve the token; unlink followed by slot reuse, or a filesystem remount, expires the view with `ENOENT`.

`InodeMetadata` contains the inode number, kind, mode, owner IDs, link count, size and timestamps. `metadata` returns this snapshot under the VFS lock. `read` validates its range, live process binding, memory instance and native read permission. `access` lets an adapter invoke existing native VFS operations while holding the process, credential and VFS locks. The adapter supplies reserved input buffers separately.

`HostInode.resolve` passes the unnormalised path and native process working directory to canonical traversal, retaining the incarnation observed under lock. `chmod`, `chown` and `utime` marshal requests to native metadata operations with live process credentials. These methods do not replace the public object filesystem yet.

Directory entry creation, hard links, rename and unlink pass through native VFS mutation functions. Cross-directory rename and links validate both inode incarnations while holding the same native VFS lock. Arena byte writes likewise invoke the existing native write operation; host-backed payloads retain their separate byte-carrier contract.

`inodeKind` maps native file, directory, link and character kinds to `f`, `d`, `l` and `c`; an unknown kind raises `EIO`.
