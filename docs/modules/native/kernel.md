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
