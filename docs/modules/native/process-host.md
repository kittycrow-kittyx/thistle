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

| Signal operation | Contract |
| --- | --- |
| `thistleProcessQueueSignal` | Check the allocated PID and supported signal; return 1 for host delivery or 0 for deferred/no delivery. |
| `thistleProcessSignalMask` | Apply block/unblock/replace under the process lock; SIGKILL remains unblocked. |

The mask operation uses a reserved 16-byte request.

| Offset | Type | Request | Successful response |
| --- | --- | --- | --- |
| 0 | u64 | Requested mask | Previous mask |
| 8 | u32 | Unused | Newly unblocked signal, or zero |

| Return value | Meaning |
| --- | --- |
| 0 | Mask applied |
| -3 (`ESRCH`) | Expired process binding |
| -11 (`EAGAIN`) | Process lock contention |
| -14 (`EFAULT`) | Request outside the input reservation |
| -22 (`EINVAL`) | Unsupported operation, signal or process state |

Supported signals are 0, 1, 2, 9, 13 and 15. The pending slot retains the hosted
single-deferred-signal contract.

Image preparation and runnable publication reject an active vfork lease; finish may mark a process zombie while the lease remains held.
