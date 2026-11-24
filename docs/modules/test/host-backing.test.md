# Host carrier regression tests

Tests mutate caller and returned buffers to check byte isolation. A suspended
lazy read races with replacement; its completion returns EAGAIN and retains the
replacement bytes. Carrier collection preserves the live inode's data.

Lifecycle fixtures hold a lazy provider open while reaping its reader or recycling its inode, then check that completion leaves the replacement state intact.
