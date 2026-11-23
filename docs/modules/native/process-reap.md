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
