# Native process reaping

`thistleProcessReap` validates parent/root authority and zombie state, then
releases canonical descriptors, pages and supplementary-group extensions.
Associated harts are locked before cleanup and cleared after success.

| Error | State retained |
| --- | --- |
| EAGAIN | Running process or contended lock. |
| EFAULT | Invalid guest-frame metadata. |
| ECHILD | Caller lacks parent/root authority. |
| ESRCH | No process with the requested PID. |

Page validation and release use the same arena functions as image reload.

Reaping takes the process descriptor lock after locking its harts. Contention returns `EAGAIN` without freeing descriptors or guest frames. Descriptor cleanup uses the shared `releaseDescriptor` operation.

Reaping releases retained mapping inodes after descriptor teardown and before recycling guest frames.
