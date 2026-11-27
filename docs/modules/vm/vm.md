# vm

`Sc` identifies the Thistle32 syscall numbers. `Vm.run` loads a Thistle executable and argument vector into a bounded address space, validates instruction encodings, executes the integer instruction set and returns the process exit status. The registers are signed 32-bit values; syscalls use `Sys` and convert host errors into guest errno values.

`legacyErrnoNumbers` exposes the shared WASI numbering to both legacy instruction formats.

`registerLittleEndian` records the host typed-array byte order used to read the shared compatibility register banks. Guest instructions and memory use little-endian encoding on every host.
