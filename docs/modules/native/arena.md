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
