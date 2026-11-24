# Host mapping resize tests

Checks canonical growth rejection without permission to move, moved data,
access to extended ranges, shrinking, contended release and final map removal.
The host and anonymous mapping paths use one native resize implementation.

Partial-unmap coverage checks capacity refusal before mutation, middle splits, front and tail trimming, file offsets, byte clearing and complete removal.

The descriptor-backed mapping fixture verifies open rights, inode retention after close and unlink, adjusted split offsets and final reclamation.
