# Host kernel options

`KernelOptions` describes the host services and runtime configuration. All services are explicit. Host-specific construction belongs to `createHostKernel`.

`HostAccount` accepts a configured account or session credentials.
`accountIdentity` expands it into a full credential snapshot, user name and home
path. Its default is the configured root identity used for kernel bootstrap.
