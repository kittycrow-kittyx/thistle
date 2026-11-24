# Host process views

`HostProcess` retains a hart reference and the PID allocated when the view was
created. It checks that identity under the process lock on each call. The
canonical PID allocator does not reuse IDs. A reaped or rebound view returns
ESRCH.

| Method | Contract |
| --- | --- |
| `identity` | Return a credential/group/umask snapshot under the credential lock. `HostIdentity` includes filesystem IDs separately. |
| `setIdentity` | Marshal the existing native identity operation and translate its numeric error. |
| `setGroups` | Marshal a group array through a reserved buffer; native code checks privilege and IDs. |
| `setUmask` | Call the canonical umask operation and return the previous mask. |

Snapshots contain copies. Mutating them does not change native state. The
legacy `Proc` constructor has not been switched to this view yet.
