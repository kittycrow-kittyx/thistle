# native/host-memory

`ThistlePageLookup` describes guest page lookup. `ThistleMem64` implements `RvMemory` over the canonical sparse page table without allocating an independent guest memory store.

The view retains its allocated PID and rejects access after reaping or rebinding.
`used` reads the canonical process page count, including pages allocated by
other harts attached to the same process.

`populate` installs initial mapped bytes without marking writes. `write` marks guest writes in the canonical bitmap. `flushDirty` publishes all changed spans in a range, then clears their bits after success. Publication is synchronous in the cooperative host.

The optional `onWrite` capability publishes marked host syscall output before returning to the host scheduler. `drop` clears resident frames in the requested range without allocating missing pages.
