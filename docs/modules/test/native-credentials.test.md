# Native credential regression tests

Tests cover group vectors across two extension frames, coherent snapshots,
VFS access through an extended group, failed allocation and lock contention.
RV64 ECALL tests transfer 40 groups and compare native and host identity
changes on the same process record, including saved-ID recovery and invalid
ID error contracts.
