# Host carrier regression tests

Tests mutate caller and returned buffers to check byte isolation. A suspended
lazy read races with replacement; its completion returns EAGAIN and retains the
replacement bytes. Carrier collection preserves the live inode's data.
