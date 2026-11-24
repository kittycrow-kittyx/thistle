# Root persistence

`TreeEnt` records a static image path, inode identity, kind, metadata, optional bytes or lazy provider, and symlink target. `Tree` is the host persistence interface. `fileSum` calculates the payload checksum.

`TreeFs.dump` serialises a mounted canonical root and `TreeFs.load` restores it; `treeFs` provides the shared stateless adapter. Both accept `/` only. Root replacement returns `EBUSY` if an inode descriptor is open or a process cwd is outside `/`. Live overlay reconciliation must use incremental canonical operations instead of remounting beneath running processes.
