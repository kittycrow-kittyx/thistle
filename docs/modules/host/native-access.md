# Native access from the host driver

| Export | Contract |
| --- | --- |
| `withVfsLock` | Take the canonical VFS lock for a synchronous callback and release it on return or exception. Contention returns EAGAIN. |
| `withImage` | Reserve a canonical input lease for a synchronous callback. Retry contended release on the host event loop. |

Release retries repeat only cleanup. They do not repeat the callback or report
an already committed operation as failed. The canonical image lock retains
ownership until the release succeeds.

`withNativeLock` applies the same synchronous callback contract to a specified
canonical lock. `checkNative` translates errors through the shared
`errnoNumbers` table, with EIO for unknown numeric statuses.
