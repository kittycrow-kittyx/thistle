# Host process execution boundary

| Operation | Canonical state transition |
| --- | --- |
| `thistleProcessPark` | Park the process harts while a host callback owns execution. |
| `thistleProcessPrepareImage` | Quiesce all process harts, reset the leader registers and retire secondary execution before loading an image. |
| `thistleProcessRunImage` | Make the leader runnable after an executable image has been loaded. |

These are trusted embedding operations. They hold the process lock and every
bound hart lock. Contention returns EAGAIN before mutation. Only the process
leader can change the image lifecycle; peer processes retain their state.

Initialisation rejects an already bound hart. Replacing an image retains its
process identity and uses the image loader to recycle old frames.
