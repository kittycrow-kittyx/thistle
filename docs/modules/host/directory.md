# Host directory snapshots

`DirectoryItem` contains a decoded name, canonical inode ID and inode kind.
`readDirectory` takes a reserved buffer and VFS lock, then consumes native
`thistleVfsReadEntry` records until EOF. Its returned array is a snapshot.
Subsequent calls read current native entries, including unlink and inode reuse.

`readDirectory` takes a `HostInode` directory view and a `HostProcess` caller. It checks their bindings while holding the process, credential and VFS locks, then returns `DirectoryItem` snapshots from native cursor records.

`readOpenDirectory` enumerates the same native records through a live directory descriptor. It uses the open rights instead of rechecking pathname permissions.
