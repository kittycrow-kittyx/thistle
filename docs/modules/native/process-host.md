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

`thistleProcessSetHostState` updates the existing process state word after
checking the allocated PID. Ready, running, sleeping and stopped phases are
accepted; a zombie cannot be made live again. Hart events retain per-thread
CPU readiness while the process records host callback phase.
