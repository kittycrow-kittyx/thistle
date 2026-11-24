# kernel

`Kern` owns one `canonical` memory context and the remaining host VFS, app registry, callback records, scheduler and network boundary. Native memory owns process identity, credentials and guest pages. `Start` describes child launch overrides, including descriptor inheritance, environment, working directory and process group. `PInfo` describes process listings and `Mnt` mount metadata. The kernel resolves executable paths, checks permissions, dispatches supported guest formats and processes exit or image replacement.

`StartIo` identifies explicit stream overrides; `emptyStart` provides a launch configuration with all overrides absent.

`KernelOptions` names the host dependencies and system configuration required at kernel construction.

Signal delivery consults the canonical mask before completing a sleeping callback. Deferred signals leave that callback alive.

Sessions retain standard-stream references so child exit leaves the parent's inherited input open.

Construction requires `KernelOptions`; there is no implicit host service discovery or default transport in the kernel graph. JavaScript callers may use `createHostKernel` outside that graph.

`cloneFd` and explicit child descriptor inheritance delegate to `FdTable.inherit` instead of reconstructing a path-based descriptor.

`Kern` starts its root loader process and mounts `Vfs` in the same native memory as the process/hart tables. `session` selects the requested home through canonical cwd, falling back to `/` only when the home is absent. `start` inherits the live cwd inode unless an explicit working directory is supplied. Executable loading verifies execute rights on the selected inode before the trusted loader reads its bytes.
