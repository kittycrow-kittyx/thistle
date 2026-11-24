# Native vfork lease

`thistleVforkBegin` accepts a parked single-hart parent in a clone syscall and a fresh, parked child with its own process identity and descriptors. Supported flags are CLONE_VM and CLONE_VFORK, optional CLONE_SETTLS, and exit signal zero or SIGCHLD. The actual address-space tables transfer to the child; the parent's registers stay in its hart. The reciprocal PID links prevent early parent resume and process-slot reaping.

`thistleVforkRelease` returns the original table allocations to their owners, clears the lease and resumes a live parent with the child's PID. A zombie parent stays a zombie. The child is parked for image replacement or remains exited. Both operations hold the process registry, hart, process and VFS locks; dirty shared mappings must be published first. This primitive does not yet dispatch the hosted child or change descriptor cursor sharing.
