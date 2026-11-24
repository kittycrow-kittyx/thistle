# Host directory snapshots

`DirectoryItem` contains a decoded name, canonical inode ID and inode kind.
`readDirectory` takes a reserved buffer and VFS lock, then consumes native
`thistleVfsReadEntry` records until EOF. Its returned array is a snapshot.
Subsequent calls read current native entries, including unlink and inode reuse.
