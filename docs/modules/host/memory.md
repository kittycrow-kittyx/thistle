# Host memory carrier

`src/host/native-access.ts` extends the native memory carrier with instance-owned external byte and character-device transports. `hostMemory()` delegates allocation to `directMemory()` and retains the same native memory layout. It does not introduce a process, descriptor or filesystem model.

Each carrier has a nullable backing service and a device map. Their lifetime follows that carrier, without a global registry retaining unrelated kernels. Native memory remains authoritative for permissions, inode identities, descriptor lifetimes and offsets. Native-only entry points continue importing `native/memory.ts` directly.

The host backing and device tests cover independent carriers with identical inode slots, descriptor reuse, stale asynchronous reads and revoked native access.
