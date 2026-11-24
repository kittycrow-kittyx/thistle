# Host process execution boundary

| Operation | Canonical state transition |
| --- | --- |
| `thistleProcessPark` | Park the process harts while a host callback owns execution. |
| `thistleProcessPrepareImage` | Quiesce all process harts, reset the leader registers and retire secondary execution before loading an image. |
| `thistleProcessRunImage` | Make the leader runnable after an executable image has been loaded. |

These are trusted embedding operations. They hold the process lock and every
bound hart lock. Contention returns EAGAIN before mutation. Only the process
leader can change the image lifecycle; peer processes retain their state.

`thistleProcessFinish` accepts the allocated PID and exit code. It rejects an
expired view with ESRCH, then records the exit status and retires every bound
hart under the process and hart locks.
