# Host process views

`HostProcess` retains a hart reference and the PID allocated when the view was
created. It checks that identity under the process lock on each call. The
canonical PID allocator does not reuse IDs. A reaped or rebound view returns
ESRCH.

| Method | Contract |
| --- | --- |
| `identity` | Return a credential/group/umask snapshot under the credential lock. `HostIdentity` includes filesystem IDs separately. |
| `setIdentity` | Marshal the existing native identity operation; null means unchanged, and invalid host IDs retain EPERM semantics. |
| `setGroups` | Marshal a group array through a reserved buffer; native code checks privilege and IDs. |
| `setUmask` | Call the canonical umask operation and return the previous mask. |

Snapshots contain copies. Mutating them does not change native state. The
hosted `Proc` reads its identity through this view.

`installIdentity` marshals constructor or validated-exec metadata through the
native loader batch. Permission checks for guest requests remain in the set-ID
operations.

`pid` identifies the allocated view. `parentPid` and `groupId` read canonical
process metadata; the trusted group setter updates the native word atomically.
`finish` retires all process harts after checking the allocated PID.
`memory` and `hart` route guest execution to this same record.

`HostIdentityField` names individual identity words. `id` reads one word under
the credential lock, avoiding supplementary-group copies for scalar getters.

`HostProcessState` names the hosted phase labels. `HostProcessPhase` is a
state/exit-code snapshot read by `phase` under the process lock. `setState`
updates the canonical phase through the PID-checked native operation.
