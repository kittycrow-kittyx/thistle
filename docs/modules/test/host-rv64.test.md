# Hosted RV64 integration tests

Checks output from a canonical RV64 guest on a non-zero hart in the hosted
kernel's existing memory instance. Repeated setuid/getuid/exit execution verifies
shared native credentials, process reaping and frame reuse. Host credential
requests also exercise native permission checks and snapshot isolation.

Concurrent guests use distinct harts and pages in shared kernel memory. An
execve fixture replaces its image while retaining the canonical PID, then
verifies that reaping returns the allocator to its initial position.

A killed guest's delayed output is released while another guest occupies the
same hart. The new guest must remain waiting for its own output completion.

A blocked RV64 stdin fixture is killed and reaped before its hart is reused. The next guest receives its input byte, and its parent retains access to the shared stream.

A guest mapping fixture closes its descriptor, renames the file and writes through the mapped address before exit. The renamed inode retains the write.

The shared mapping dirty-byte fixture suspends a guest after writing one byte, changes a different byte through the filesystem, and checks both changes after exit.

The alias fixture maps the same file twice, stores through one mapping and immediately loads through the other without a syscall between the instructions.

The dirty-byte guest also reads the changed file byte after resuming. A second blocked guest is killed and reaped to check write-back before signal delivery.
