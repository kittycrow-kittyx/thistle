# Thistle documentation

- [Kernel architecture](architecture.md)
- [Single-kernel consolidation](consolidation.md)
- [Native kernel](native-kernel.md)
- [Filesystem](filesystem.md)
- [Programme execution](execution.md)
- [Processes and descriptors](processes.md)
- [System calls](syscalls.md)

## Build

```sh
git submodule update --init --recursive
bun install
bun run guards
bun run check
bun run test
```

## Module reference

- [apps/base](modules/apps/base.md)
- [thistle-asm/asm](modules/thistle-asm/asm.md)
- [thistle-asm/checked](modules/thistle-asm/checked.md)
- [thistle-asm/codec](modules/thistle-asm/codec.md)
- [thistle-asm/expr](modules/thistle-asm/expr.md)
- [thistle-asm/fmt](modules/thistle-asm/fmt.md)
- [thistle-asm/isa](modules/thistle-asm/isa.md)
- [thistle-asm/isa64](modules/thistle-asm/isa64.md)
- [thistle-asm/lib](modules/thistle-asm/lib.md)
- [thistle-asm/link](modules/thistle-asm/link.md)
- [thistle-asm/pre](modules/thistle-asm/pre.md)
- [thistle-asm/syn](modules/thistle-asm/syn.md)
- [thistle-asm/kittyx/src/dependencies](modules/thistle-asm/kittyx/src/dependencies.md)
- [thistle-asm/kittyx/src/index](modules/thistle-asm/kittyx/src/index.md)
- [thistle-asm/kittyx/src/targets](modules/thistle-asm/kittyx/src/targets.md)
- [thistle-asm/kittyx/src/thx](modules/thistle-asm/kittyx/src/thx.md)
- [core/cap](modules/core/cap.md)
- [core/config](modules/core/config.md)
- [core/err](modules/core/err.md)
- [core/host-kernel](modules/core/host-kernel.md)
- [core/identity](modules/core/identity.md)
- [core/kernel](modules/core/kernel.md)
- [core/kernel-memory](modules/core/kernel-memory.md)
- [core/native-types](modules/core/native-types.md)
- [core/proc](modules/core/proc.md)
- [core/fd](modules/core/fd.md)
- [core/release](modules/core/release.md)
- [core/rv64-arithmetic](modules/core/rv64-arithmetic.md)
- [core/rv64-branch](modules/core/rv64-branch.md)
- [core/rv64-fclass](modules/core/rv64-fclass.md)
- [core/rv64-immediate-op](modules/core/rv64-immediate-op.md)
- [core/rv64-numbers](modules/core/rv64-numbers.md)
- [core/rv64-register](modules/core/rv64-register.md)
- [core/rv64-word](modules/core/rv64-word.md)
- [core/sched](modules/core/sched.md)
- [core/sys](modules/core/sys.md)
- [fs/tree](modules/fs/tree.md)
- [fs/vfs](modules/fs/vfs.md)
- [fs/nodes](modules/fs/nodes.md)
- [fs/paths](modules/fs/paths.md)
- [io/stream](modules/io/stream.md)
- [io/tty](modules/io/tty.md)
- [native/abi](modules/native/abi.md)
- [native/kernel](modules/native/kernel.md)
- [native/memory](modules/native/memory.md)
- [native/start](modules/native/start.md)
- [native/state](modules/native/state.md)
- [native/process-state](modules/native/process-state.md)
- [native/thx](modules/native/thx.md)
- [native/types](modules/native/types.md)
- [native/vfs](modules/native/vfs.md)
- [native/vfs-edit](modules/native/vfs-edit.md)
- [native/vfs-api](modules/native/vfs-api.md)
- [native/word](modules/native/word.md)
- [net/host-fetch](modules/net/host-fetch.md)
- [net/net](modules/net/net.md)
- [test/kernel-memory.test](modules/test/kernel-memory.test.md)
- [test/native-vfs-syscall.test](modules/test/native-vfs-syscall.test.md)
- [test/native-word.test](modules/test/native-word.test.md)
- [test/net-boundary.test](modules/test/net-boundary.test.md)
- [vm/mem64](modules/vm/mem64.md)
- [vm/rv64-immediate](modules/vm/rv64-immediate.md)
- [vm/vm](modules/vm/vm.md)
- [vm/vm64](modules/vm/vm64.md)
- [wasm/guest-runner](modules/wasm/guest-runner.md)
- [wasm/host-wasi](modules/wasm/host-wasi.md)
- [wasm/wasi](modules/wasm/wasi.md)
- [vm/files](modules/vm/files.md)
- [native/arena](modules/native/arena.md)

- [Guest execution](modules/core/guest.md)
- [Host kernel options](modules/core/host-options.md)
- [RV64 instruction decoding](modules/core/rv64-decode.md)

## Hosted RV64 execution

- [vm/rv64](modules/vm/rv64.md)
- [vm/linux-events](modules/vm/linux-events.md)
- [native/host-memory](modules/native/host-memory.md)
- [native/host-exports](modules/native/host-exports.md)
- [native/vfs-image](modules/native/vfs-image.md)
- [test/host-rv64.test](modules/test/host-rv64.test.md)

- [test/native-vfs-edit.test](modules/test/native-vfs-edit.test.md)

- [test/native-process-reap.test](modules/test/native-process-reap.test.md)
- [test/native-process-state.test](modules/test/native-process-state.test.md)

- [native/credentials](modules/native/credentials.md)
- [native/process-reap](modules/native/process-reap.md)
- [test/vfs-fixture](modules/test/vfs-fixture.md)
- [test/native-credentials.test](modules/test/native-credentials.test.md)

- [Compiler validation](compiler-validation.md)

- [native/vfs-backing](modules/native/vfs-backing.md)
- [test/native-vfs-backing.test](modules/test/native-vfs-backing.test.md)

- [host/backing](modules/host/backing.md)
- [test/host-backing.test](modules/test/host-backing.test.md)

- [host/native-access](modules/host/native-access.md)
- [host/directory](modules/host/directory.md)

- [test/host-native-access.test](modules/test/host-native-access.test.md)

- [host/bytes](modules/host/bytes.md)
- [test/host-bytes.test](modules/test/host-bytes.test.md)

- [test/native-process-attach.test](modules/test/native-process-attach.test.md)

- [core/errno](modules/core/errno.md)
- [host/process](modules/host/process.md)
- [host/cwd](modules/host/cwd.md)
- [host/descriptor](modules/host/descriptor.md)
- [host/devices](modules/host/devices.md)
- [test/host-process.test](modules/test/host-process.test.md)

- [test/native-image-lifetime.test](modules/test/native-image-lifetime.test.md)

- [native/process-host](modules/native/process-host.md)
- [native/vfork](modules/native/vfork.md)
- [test/native-process-host.test](modules/test/native-process-host.test.md)

- [host/context](modules/host/context.md)
- [host/limits](modules/host/limits.md)

- [test/native-guest-access.test](modules/test/native-guest-access.test.md)

- [test/native-host-map.test](modules/test/native-host-map.test.md)
- [test/native-vfork.test](modules/test/native-vfork.test.md)

- [test/host-lifecycle.test](modules/test/host-lifecycle.test.md)
- [test/host-descriptor.test](modules/test/host-descriptor.test.md)
- [test/host-file-descriptor.test](modules/test/host-file-descriptor.test.md)
- [test/host-carrier-descriptor.test](modules/test/host-carrier-descriptor.test.md)
- [test/host-path-open.test](modules/test/host-path-open.test.md)
- [test/host-device.test](modules/test/host-device.test.md)
- [test/host-root.test](modules/test/host-root.test.md)

- [test/native-signals.test](modules/test/native-signals.test.md)

- [io/read-queue](modules/io/read-queue.md)
- [test/host-input.test](modules/test/host-input.test.md)

- [host/inode](modules/host/inode.md)
- [test/host-inode.test](modules/test/host-inode.test.md)
- [test/host-linux-events.test](modules/test/host-linux-events.test.md)

- [test/native-vfs-resolve.test](modules/test/native-vfs-resolve.test.md)

- [test/host-restore.test](modules/test/host-restore.test.md)

- [host/mount](modules/host/mount.md)
- [host/root](modules/host/root.md)
- [host/snapshot](modules/host/snapshot.md)
- [test/host-mount.test](modules/test/host-mount.test.md)

- [test/native-vfs-mount.test](modules/test/native-vfs-mount.test.md)
