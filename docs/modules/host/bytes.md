# Shared lazy byte transport

`RegSource` is the static-root provider contract: logical size, checksum,
optional header bytes and an async load function. The original filesystem module
re-exports this type for existing consumers.

`SourceLoad` coalesces concurrent provider requests, checks the returned byte
length and clears its pending promise after success or failure. It stores no
inode, permission or filesystem state. Both the legacy `Reg` reference and the
canonical `HostBacking` adapter use it. Each caller controls publication.

`fileSum` retains the persistence format's existing content checksum for both legacy and canonical snapshots.
