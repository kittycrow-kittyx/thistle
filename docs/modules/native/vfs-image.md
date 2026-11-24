# native/vfs-image

`serializeThistleVfs` serialises `TreeEnt` entries into the bounded native VFS image format. It is useful for native VFS tests and explicit snapshot consumers. Hosted guests use the live VFS rather than a read-only snapshot.

`VfsEntries` is the accepted static tree-entry sequence. `planHostThistleVfs` uses the same topology and hard-link validation as `serializeThistleVfs`, but stores regular payloads in the returned plan rather than the binary image. `HostVfsImage` contains that image, one entry per regular-file inode and the resident quota required for installation. Lazy sources contribute no resident bytes until loaded.
