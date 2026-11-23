# Native process identity

| Export | Contract |
| --- | --- |
| `thistleProcessRecord` | Return the current native record address for a hart, or `0xffffffff`. The caller must not retain it across reaping/reuse. |
| `thistleNextPid` | Allocate from the canonical PID counter. Return zero for invalid state, contention or exhaustion; never wrap to an existing identity. |
| `thistleProcessIdentity` | Apply the UID/GID operation below under the credential lock. Return zero, the previous filesystem ID, or negative errno. |
| `thistleProcessGroups` | Replace at most `THISTLE_GROUP_CAPACITY` supplementary groups as root, using a reserved input buffer. Validate every ID before changing the record. |
| `thistleProcessUmask` | Store the low nine mask bits in the native process record and return the previous mask. |

Identity operations use `0xffffffff` for an unchanged res/re ID. Invalid
res/re/single IDs and forbidden privilege changes return EPERM. Invalid
filesystem IDs leave the existing filesystem ID unchanged. Changing effective
identity also resets the filesystem identity, matching the hosted contract.

| Operation | UID | GID | Arguments |
| --- | --- | --- | --- |
| res | 0 | 1 | real, effective, saved |
| re | 2 | 3 | real, effective; saved follows the established re-ID rule |
| single | 4 | 5 | requested ID; root changes all three, other callers change effective only |
| filesystem | 6 | 7 | requested filesystem ID; return its previous value |

The group capacity is the existing native ABI limit of 32. The hosted API
previously accepted longer arrays; that compatibility gap must be resolved or
explicitly approved before the old hosted implementation is removed.
