# stream

`In` and `Out` define byte-stream endpoints. `enc` and `dec` convert UTF-8; `MemIn` and `MemOut` provide in-memory endpoints; `FnOut` delegates writes to a host callback; `Pipe` connects producers to readers and `TeeOut` forwards output to multiple endpoints. Reference counts and closure affect EOF.

`Stream` supplies the default lifecycle contract for endpoints that do not need reference counting.

`TerminalState` describes terminal attributes and dimensions. Pipes expose readiness (`readable`, `writable`, `onChange`) and reference-counted closure for hosted event polling.

`In.rd` accepts a process abort signal. Pipe reads cancel one pending operation with `EINTR`, preserving the shared endpoint for other processes. Custom asynchronous input transports must honour this signal to prevent abandoned reads consuming later input.
