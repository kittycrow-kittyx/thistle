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

`thistleProcessReap` checks the parent/root relationship and zombie state,
locks all associated harts and releases descriptor and backing-frame resources.
Contended locks return EAGAIN; invalid page metadata returns EFAULT before resources are released.
Recycled frames are zeroed before reuse; free tail frames lower the physical
high-water mark so later image reservations can use that memory.

`thistleProcessRecord`, `thistleNextPid`, `thistleProcessIdentity`,
`thistleProcessGroups` and `thistleProcessUmask` are re-exported from
[process-state](process-state.md). Host adapters use these canonical records
and credential operations instead of maintaining their own authoritative copies.
