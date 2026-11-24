# Native arena

| Export | Contract |
| --- | --- |
| `inputContains` | Check the image lock and reserved byte range without changing the lease. |
| `validFrame` | Check alignment and allocated physical arena bounds. |
| `allocateFrame` | Reuse a free frame or advance the physical cursor; zero all bytes before returning. |
| `releaseFrame` | Link an allocated frame into the canonical free list. |
| `trimFreeFrames` | Remove free tail frames and reduce the physical cursor. |

Frame allocation, release and trimming require the canonical memory lock.
Guest pages and supplementary-group extensions share the allocator.

`validProcessFrames` validates the process page table's physical frame bounds.
`releaseProcessFrames` returns its frames to the shared free list and clears
the table under the memory lock. Reaping and image reload reuse these operations.

`markDirtyBytes` allocates and marks a byte-precise bitmap in a canonical auxiliary frame. `hasDirtyBytes` checks a span; `clearDirtyBytes` clears acknowledged bits. The auxiliary frame is retained until image reset or process reaping, and validated and reclaimed with its guest frame.
