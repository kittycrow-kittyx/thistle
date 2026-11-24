# descriptor

`HostDescriptor` is a non-owning view of a host capability slot. `next` finds a free canonical descriptor number, `install` attaches access flags and an initial offset, and `close` invokes canonical teardown. Flags and offsets read live memory. The slot incarnation prevents a closed view from editing a reused descriptor.
