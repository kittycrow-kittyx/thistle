# inode

`HostInode` holds a native inode number and its incarnation token. Metadata and arena reads consult canonical memory. Writes, renames and hard links preserve the token; unlink followed by slot reuse, or a filesystem remount, expires the view with `ENOENT`.

`metadata` returns a coherent snapshot under the VFS lock. `read` validates its range, live process binding, memory instance and native read permission. `access` lets an adapter invoke existing native VFS operations while holding the process, credential and VFS locks. The adapter supplies reserved input buffers separately.
