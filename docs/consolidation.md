# Single canonical kernel consolidation

This branch starts from release `v2.2.3`, commit
`5338d14b4ecb974ce56c4d13900ba34962a32093`. The release tags and downstream
production pins remain unchanged. This is an incremental migration, not a
claim that the hosted engine has already been removed.

## Baseline evidence

The published Teto, Rei and Rusty Rei `v2.2.0` manifests pin Thistle `v2.2.1`
at `76932c85c4db2eb481345aafe8611e6f53de9d85`. The mikuOS reference is
`98998e4fe1bf23db1fdbf691c25457a0ef831750`, which pins Thistle `v2.2.3`.
Source revision differences must be explicit in every validation receipt.

Unmodified `v2.2.3` was tested separately before changing its implementation:

- TypeScript checking and all 13 original kernel tests passed under Bun 1.4.5.
- Bake `v1.0.1` emitted the 19-module native graph for WASM, C and Rust with
  zero errors and zero warnings.
- Baguette `v1.0.1` generated and compiled baseline and threaded WAT, verified
  deterministic rebuilds, instantiated the modules and checked the ABI.
- Croissant `v1.0.1` emitted the canonical C graph. Clang 19 compiled it with
  `-Werror` for all six declared targets: amd64, arm64, riscv64, riscv32,
  armv7 and i686.
- Crust `v1.0.1` emitted the Rust graph. Rust 1.85.1 compiled it with
  `-D warnings` for amd64, arm64, riscv64, riscv32 and armv7. Nightly 1.102.0
  (commit `137d1d494`, 22 November 2026) also compiled those five targets and
  the declared i686 target using `build-std=core,compiler_builtins`. Generated
  kernel crates used `-D warnings`; Cargo emitted a future-compatibility notice
  originating in its nightly core library.
- The unmodified `v2.2.1` C and Rust graphs were also generated successfully
  with zero Bake errors and warnings, using the same backend revisions.

No C or Rust bare-metal boot is claimed. These targets produce libraries and
objects. Runtime equivalence requires executable ABI fixtures in addition to
compilation.

## State ownership and required migration

| Hosted owner or entry | Canonical replacement | Migration constraint |
| --- | --- | --- |
| `Kern.procs`, PID sequence | Native process table and allocator | Host records may retain argv, callbacks and I/O carriers, but not a second process-state authority. |
| `Proc` credentials, state and descriptors | Native process/descriptor fields | Signals, saved IDs, groups, descriptor identity and lifecycle must retain their contracts. |
| `Sched.ready` and process transitions | Native scheduler/process state | A Bun event-loop driver may marshal callbacks; it must not own a competing ready queue. |
| Object `Vfs.root` and mutable nodes | Native inode, dentry and payload tables | File data, hard links, permissions, lazy host payloads, devices and persistence need a non-owning adapter. |
| `Sys` policy and mutations | Canonical kernel operations | A public compatibility facade may marshal requests, without implementing kernel policy again. |
| Hosted `Rv64` setup and syscall fallback | Shared canonical kernel memory and native execution | Native instruction execution already exists. Per-guest kernel instances and duplicated process/VFS state must be removed. |
| `Vm` and `Vm64` | Canonical compatibility execution | Keep supported Thistle32/Thistle64 behaviour until migrated and proved. No silent guest-format deletion. |
| `createHostKernel` and default options | Explicit Bun capability/session adapter | Host discovery, networking and WASI stay outside the native compilation graph. |
| `treeFs` object traversal | Canonical image/persistence serialisation | Preserve `.thistle.base`, writable overlays, file identity and metadata. |

The preserved mikuOS distribution includes `Os`, `Shell`, applications and its
base userland. Its kernel construction and filesystem access will be rewired
only after the consolidated Thistle and backend release gates pass.

## First implementation increment

`native/vfs-edit.ts` implements mutation against the existing native VFS tables.
It reuses the existing lookup, permission and memory mechanisms, rather than
copying the hosted object filesystem. Tests exercise the canonical functions
directly, including hard links, failed allocation, descriptor lifetime, entry
reuse, metadata permissions and rename ancestry.

The hosted VFS and process classes remain temporarily as the reference engine.
They are not the final architecture. Removing them is gated on the adapter,
behavioural parity, single-owner import checks and clean backend validation.

## Promotion gates

1. Complete exact-release baseline and source/API ownership inventory.
2. Move required semantics into the canonical native-compatible core and add
   a non-owning Bun adapter. Keep every supported behaviour covered.
3. Remove retired state owners, entry points and fallback engines after parity.
4. Require strict guards and zero Thistle Bake errors/warnings for all targets;
   generate and compile the same candidate through all three backend chains.
5. Version, validate and release the consolidated Thistle without rewriting tags.
6. Publish verified compatibility releases of Bake, the three backends and the
   three generated runtimes from their existing release baselines.
7. Repin and adapt mikuOS, then prove real input, `/bin/dd`, persistence,
   credentials and guest execution through the single canonical source.
8. Resume mikuOS-specific lowering and subsequently demonstrated Leek gaps.

The Pages repository, unrelated toolchains, branding and machine configuration
remain outside this work. No release or completed consolidation is claimed by
this document.


## Process consolidation increment

Native reaping now releases descriptor references and guest frames, preserving
other live processes. Frame reuse and tail trimming support a long-lived
kernel instance. The PID allocator, credential operations and umask use the
canonical record; differential tests compare the existing hosted contract.
The hosted process, filesystem and scheduler facades have not yet been switched.

Supplementary groups now use canonical extension frames beyond the 32 inline
entries. RV64 syscalls, host operations and VFS permission checks share that
storage; identity policy is shared between ABI callers. ABI 11 adds the
extension pointer without changing process stride.

The storage adapter remains unresolved: `Lim.host()` permits sparse filesystem
budgets above the native in-memory arena's 128 MiB limit. Preserving lazy host
payloads requires a backing-storage capability with canonical inode, path,
permission and descriptor authority.

## Validated credential and compiler checkpoint

Commit `99ad2dcc87bb74bf4192bf695d73b37c4e9b89db` passed Kernel validation
run 45217753714 and Canonical compiler validation run 45217753684. The latter
covers released Bake/Baguette/Croissant/Crust, zero kernel diagnostics, compiled
baseline/threaded WASM credential checks, and six C plus six Rust targets.
These are candidate compilation checks, not releases or mikuOS boot evidence.

## Backing-storage increment

Canonical inode records can reference an opaque host byte carrier with separate
logical size, resident bytes and payload revision. A reserved descriptor commits
storage metadata only after permission, version and resident-quota checks.
Native arena access returns EXDEV for these inodes. The Bun carrier and filesystem
facade are not connected yet. Filesystem ownership remains a migration gate.

The untagged ABI 11 inode stride changes to 80 bytes for resident accounting and
payload versions. The VFS image format and process stride remain unchanged.
No release archive or consumer pin uses this candidate layout.
