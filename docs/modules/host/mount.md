# mount

`mountHostTree` restores static tree entries into a process's canonical kernel and returns its `HostBacking` registry. The caller needs filesystem UID zero. Quota and native table capacity are checked before mounting. Regular bytes and lazy providers are installed through the native restoration operation; directories, symlinks and ownership use the existing image serializer.

An open file or a process working outside the root blocks replacement with `EBUSY`. Remounting expires earlier inode views and byte registries. This root loader is intended for boot and explicit image replacement, not subdirectory overlays.

The image and all provider registrations are installed under one process, credential and VFS lock scope. Providers are registered without fetching their content.
