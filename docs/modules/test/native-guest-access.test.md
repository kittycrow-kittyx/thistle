# Canonical guest access tests

Checks segment read/write/execute permissions, unmapped addresses, zero-length
range boundaries, invalid lengths, expired PID bindings and contended hart
locks. Host syscalls and instruction execution share the same native checker.
