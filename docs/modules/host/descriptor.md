# descriptor

`HostDescriptor` is a non-owning view of a host capability slot. `next` finds a free canonical descriptor number, `install` attaches access flags and an initial offset, and `close` invokes canonical teardown. Flags and offsets read live memory. The slot incarnation prevents a closed view from editing a reused descriptor.

`open` binds an existing canonical inode with native permission checks; `attach` views an already allocated slot. `kind` and `inode` report its canonical descriptor kind and inode number.
