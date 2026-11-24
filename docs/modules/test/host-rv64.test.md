# Hosted RV64 integration tests

Checks output from a canonical RV64 guest on a non-zero hart in the hosted
kernel's existing memory instance. Repeated setuid/getuid/exit execution verifies
shared native credentials, process reaping and frame reuse. Host credential
requests also exercise native permission checks and snapshot isolation.

Concurrent guests use distinct harts and pages in shared kernel memory. An
execve fixture replaces its image while retaining the canonical PID, then
verifies that reaping returns the allocator to its initial position.
