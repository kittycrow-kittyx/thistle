# host-file-descriptor.test

Opens canonical inodes through hosted descriptor views, reads through the native ABI, checks unlink retention and slot reuse, and verifies append offsets and directory write rejection.

Inheritance fixtures copy an unlinked inode into a non-root child, verify retained authority and cursor, and check that the final close releases the inode.
