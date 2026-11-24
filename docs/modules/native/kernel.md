# Native kernel ABI

The kernel uses fixed scalar types and a caller-provided linear-memory region. The control, hart, process, page, descriptor and mapping tables are defined in [the ABI constants](abi.md). Status codes are not host exceptions.

| Operation | Entry points |
| --- | --- |
| Initialisation | `thistleKernelInit`, `thistleKernelInitWithVfs`, `thistleKernelValid`, `thistleHartInit`, `thistleProcessInit`, `thistleProcessSetGroup`, `thistleProcessCount` |
| Mounted filesystem and descriptors | `thistleResolvePath`, `thistleAccessInode`, `thistleOpenPath`, `thistleReadDescriptor`, `thistleSeekDescriptor`, `thistleCloseDescriptor`, `thistleDescriptorKind`, `thistleDescriptorInode`, `thistleDescriptorOffset` |
| Executable image and mappings | `thistleImageReserve`, `thistleImageContains`, `thistleImageRelease`, `thistleImageBegin`, `thistleImageSegment`, `thistleImageFinish`, `thistleGuestPage`, `thistleProcessSegmentCount`, `thistleProcessMapCount`, `thistleProcessMapAddress`, `thistleProcessMapEnd`, `thistleProcessMapProtection` |
| Guest virtual limits and startup | `thistleHartVirtualTop`, `thistleHartImageFloor`, `thistleHartStackBottom`, `thistleHartStackPointer`, `thistleHartBreak`, `thistleStackPrepare`, `thistleStackCopy`, `thistleStackStoreU64`, `thistleStackAux`, `thistleStackFinish` |
| Hart observation and register access | `thistleHartGetX`, `thistleHartSetX`, `thistleHartGetF`, `thistleHartSetF`, `thistleHartPc`, `thistleHartSetPc`, `thistleHartStatus`, `thistleHartMetric`, `thistleHartExitCode` |
| Batch execution | `thistleRunRv64Batch`, `thistleRunSchedulerBatch`, `thistleWorkerMetric`, `thistleExitHart` |
| Host requests | `thistleHostOperation`, `thistleHostDescriptor`, `thistleHostAddress`, `thistleHostLength`, `thistleResumeSyscall`, `thistleEnableHostStdin`, `thistleResumeHost`, `thistleResumeHostRead` |

Reserve an image before loading it; release the reservation after the load. Initialise guest process and hart state before running instructions. A batch may stop for a syscall, host I/O, contention, exit or fault; consult the event and status before resuming. Guest addresses must be resolved through the page table rather than treated as physical pointers.

The three wide scalar entry points `thistleProcessInit`, `thistleImageBegin` and `thistleImageSegment` retain their positional ABI argument lists. `//@cg-expect-error` requires a finding on each declaration line. The implementations remain checked. Compiled targets own their exported symbol mapping.

`thistleMapHostFile` reserves a hosted file mapping in the canonical address space. `thistleUnmapHostFile` releases it after shared data is flushed. Guest munmap delegates overlapping hosted file mappings before reclaiming frames.


## Filesystem mutation exports

`thistleVfsCreate`, `thistleVfsWrite`, `thistleVfsLink`, `thistleVfsUnlink`,
`thistleVfsCanMove`, `thistleVfsRename`, `thistleVfsChmod`, `thistleVfsChown`
and `thistleVfsUtime` are re-exported from [vfs-edit](vfs-edit.md). Their caller
holds the VFS lock and marshals reserved input buffers. Descriptor close also
releases the final reference to an unlinked inode under that lock.


## Process ownership and lifetime

| Reaping result | Meaning |
| --- | --- |
| `0` | Zombie descriptors, group extensions and guest frames released. |
| `-EAGAIN` | Process is running or a required lock is held. |
| `-EFAULT` | Page metadata is invalid; resources retained. |

`thistleProcessReap` requires parent/root authority. Recycled frames are zeroed
before allocation. Free tail frames reduce the physical high-water mark.

`thistleProcessRecord`, `thistleNextPid`, `thistleProcessIdentity`,
`thistleProcessGroups`, `thistleProcessSetGroup`, `thistleProcessReadGroups`
and `thistleProcessUmask` are re-exported from
[process-state](process-state.md). Host adapters use these canonical records
and credential operations instead of maintaining their own authoritative copies.

Backing metadata exports `thistleVfsBacking`, `thistleVfsBackingVersion`,
`thistleVfsCommitBacking` and `thistleVfsSetQuota` are defined in
[vfs-backing](vfs-backing.md).

`thistleProcessAttach` is re-exported from process-state. Native process
initialisation and attachment share `bindProcess`. Secondary-thread detection
uses the process's `P_LEADER_HART`, allowing multiple process groups in one
kernel instance without assuming that every leader is hart zero.

`thistleProcessInstallCredentials` re-exports the loader batch from process-state.
Get-ID syscalls zero-extend the unsigned 32-bit identity words before returning
a 64-bit guest result.

Image loading requires a quiescent process controlled by the embedding driver.
`thistleImageBegin` returns old guest pages through the shared allocator before
resetting image metadata. Contended allocation or remaining host-file mappings
return THISTLE_THX_BUSY; invalid frame metadata returns THISTLE_THX_MEMORY.

`thistleProcessPark`, `thistleProcessPrepareImage` and `thistleProcessRunImage`
are the trusted host lifecycle operations in [process-host](process-host.md).
They park callbacks, quiesce replacement images and activate loaded images
under process and hart locks.

`thistleProcessFinish` re-exports the checked host completion operation from
process-host. The allocated PID must still match the hart binding.

`thistleGuestAccess` accepts a hart, expected PID, guest address, byte length and
read/write/execute permission bits. It checks canonical mappings under the hart
lock.

| Access result | Meaning |
| --- | --- |
| `0` | Access permitted |
| `-EFAULT` | Inaccessible guest memory |
| `-ESRCH` | Expired process binding |
| `-EAGAIN` | Hart lock contention |

`thistleRemapHostFile` reads the calling hart's mremap arguments from a0-a4
and applies the shared canonical mapping resize policy to hosted file mappings.
The embedding flushes truncated shared bytes before calling it and updates
its byte-carrier routing after success. Reservation, release and resize hold
both hart and process locks against reaping or concurrent execution.

`thistleProcessSetHostState` re-exports the PID-checked callback phase update
from process-host. The native process state word also supplies host listings
and ready snapshots.


`thistleProcessQueueSignal` and `thistleProcessSignalMask` re-export canonical
signal metadata operations from process-host. Host adapters marshal delivery
through their abort capabilities.

Mounted guest close and `thistleCloseDescriptor` use the same descriptor teardown and final-inode release.

`thistleVfsWriteDescriptor` is the VFS-lock-protected arena write primitive for an
already validated descriptor record. It uses the open flags and offset, returns
a byte count or negative errno, and does not resolve the pathname again.

`thistleVfsCommitDescriptorBacking` re-exports the open-file carrier publication primitive from [vfs-backing](vfs-backing.md).

Mounted RV64 `openat` accepts existing-file read, write, read/write, append, directory and close-on-exec flags. Native arena writes use the same descriptor write policy as host calls; host-backed data and non-console host capabilities delegate to the registered transport when `THISTLE_FLAG_HOST_TRANSPORT` is enabled. Creation, exclusive, truncate and no-follow flags use the common `thistleVfsOpenPath` implementation. `thistleOpenPath` supplies default mode 0666 and timestamp zero; RV64 supplies mode and batch time.

The dispatcher imports the filesystem surface from [vfs-api](vfs-api.md), which re-exports the existing VFS implementations without additional state. Path open holds the descriptor, credential and VFS locks.

`thistleVfsCreateSymlink` creates and attaches a complete symlink in one VFS transaction; the caller supplies the validated buffer and holds the filesystem locks.

`thistleMapHostDescriptor` validates an open file descriptor and records its inode, rights and file offset before returning a mapping. The reference survives descriptor closure and map splitting until the final range is removed.

`thistleMapHostAnonymous` uses canonical anonymous mapping policy after host write-back. Native anonymous MAP_FIXED requests that overlap file mappings delegate to the host before discarding mapped bytes.

`thistleMarkGuestWrite` marks host writes through the native page bitmap. Guest stores and atomic writes use the same operation. Unmap and file remap reject dirty spans until write-back is acknowledged.

The shared-file mapping flag avoids scanning the map table for ordinary guest stores. It tracks retained shared write authority, including mappings temporarily protected against writes.

Guest batches with multiple shared views yield after a mapped write, allowing the byte transport to publish the change before another guest instruction. `thistleMarkGuestWrite` returns one when shared bytes were marked, zero for other writes, and a negative errno on failure.

`thistleVforkBegin` and `thistleVforkRelease` manage the native address-space lease. A parked parent cannot resume its clone syscall until release.
