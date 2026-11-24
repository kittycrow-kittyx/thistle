# descriptor

`HostDescriptor` is a non-owning view of a host capability slot. `next` finds a free canonical descriptor number, `install` attaches access flags and an initial offset, and `close` invokes canonical teardown. Flags and offsets read live memory. The slot incarnation prevents a closed view from editing a reused descriptor.

`open` binds an existing canonical inode with native permission checks; `attach` views an already allocated slot. `kind` and `inode` report its canonical descriptor kind and inode number.

`find` returns a live slot view or null; `active` captures occupied slots and identities under the descriptor lock.

`readFile`, `writeFile` and `seekFile` invoke native descriptor operations while retaining the slot and VFS locks. Host-backed payloads return `EXDEV` until the carrier transport is selected. Host calls transfer at most 1 MiB per read or write.

`withStorage` lends a validated descriptor record to a synchronous byte transport under the descriptor and VFS locks. Do not retain the pointer or await inside the callback.

`readFile` and `writeFile` select the registered byte carrier for host-backed inodes, otherwise use the native arena. `materialiseFile` awaits the carrier when needed and does not move the descriptor offset.

`openPath` marshals the path, flags, creation mode and optional starting inode to the same native path-open operation used by RV64.
