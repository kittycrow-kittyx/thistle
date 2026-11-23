# Canonical credentials

| Export | Contract |
| --- | --- |
| `updateIdentity` | Apply res/re/single/filesystem UID or GID policy to a canonical record. ABI callers validate arguments and hold credential and VFS locks. |
| `readGroup` | Read an inline or extended group under the credential or VFS lock. |
| `replaceGroups` | Allocate a private replacement chain and publish after allocation succeeds. Caller holds the credential lock; function takes memory and VFS locks. |
| `writeGroup` | Replace an ID or append at the current count during trusted initialisation. Same lock contract as replacement. |
| `releaseGroups` | Free extension frames and reset the count. Caller holds credential, memory and VFS locks. |

RV64 syscalls and the host ABI share identity policy. Invalid native single
or filesystem IDs return EINVAL; the host filesystem API returns the unchanged
old ID. VFS permission checks read the canonical group records.
