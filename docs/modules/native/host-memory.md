# native/host-memory

`ThistlePageLookup` describes guest page lookup. `ThistleMem64` implements `RvMemory` over the canonical sparse page table without allocating an independent guest memory store.

The view retains its allocated PID and rejects access after reaping or rebinding.
`used` reads the canonical process page count, including pages allocated by
other harts attached to the same process.
