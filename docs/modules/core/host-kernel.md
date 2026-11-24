# host kernel

`createHostKernel` constructs the JavaScript-host kernel with host-specific facilities. This is the integration boundary for a TypeScript host; native RV64 compilation uses the independent native ABI and memory entry points instead of host Fetch and WebAssembly execution.

`hostLimits` performs JavaScript host resource discovery. Constructing `Kern` directly requires an explicit options record and does not import Fetch, host RAM discovery or the host WASI implementation.
