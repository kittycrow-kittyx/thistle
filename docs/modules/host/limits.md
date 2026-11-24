# host/limits

`hostLimits` derives resource ceilings from the host's reported RAM, with a 2 GiB fallback when host discovery is unavailable. It accepts `THISTLE_FS_MB`, `THISTLE_MEM_MB`, `THISTLE_STACK_MB` and `THISTLE_FUEL` overrides. Invalid limits are rejected; zero fuel disables the instruction limit. This is a host adapter and not a dependency of the kernel's explicit options contract.
