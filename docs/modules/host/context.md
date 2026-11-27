# Host kernel context

`HostContext` allocates one canonical kernel memory instance using the shared
512 MiB policy. Its constructor initialises 1,024 hart slots; the canonical
process table has 256 records.

| Method | Contract |
| --- | --- |
| `nextPid` | Allocate through the native PID counter. |
| `create` | Allocate a free canonical hart and process record, install trusted credentials and park the host callback. |
| `reap` | Release a zombie through the native parent/root operation. |

The adapter has no process registry or PID counter. Hart and process capacity
failures return EAGAIN. Guest execution receives this same `memory` instance.

`readyPids` snapshots ready identities from the native process table under
the process lock. Callers may modify the returned array without changing
canonical readiness.

External transports are owned by the [host memory carrier](memory.md). The native kernel continues to own permissions and object lifetimes.
