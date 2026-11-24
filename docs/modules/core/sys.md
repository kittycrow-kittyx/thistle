# sys

`Sys` is the process-facing syscall facade, binding a kernel instance to one process. Methods expose descriptor I/O, filesystem access, process creation, credentials and environment operations. `AppInfo` describes application registration information. Callers must use the process's credentials, not construct a privileged VFS access path.

Input reads pass the calling process abort signal to the host transport.

`fdr`, `fdw` and `seek` dispatch inode-bound descriptors to canonical descriptor operations. The legacy path-bound case remains during the root filesystem migration.
