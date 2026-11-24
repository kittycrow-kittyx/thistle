# native vfs syscall.test

Native VFS syscall tests exercise the mounted filesystem route and the host fallback when no filesystem is mounted. The fixtures initialise direct linear memory, install an executable segment and run guest instructions; assertions inspect syscall status and guest-visible data.

Hosted file mappings retain their canonical reservation until the syscall adapter flushes and releases them. The regression checks delegation before munmap discards any frames.

The mounted fixture unlinks an open file, then closes it through the RV64 syscall and checks that the inode is released.
