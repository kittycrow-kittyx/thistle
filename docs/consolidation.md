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
Hosted identity and RV64 instance ownership are migrated below. Filesystem,
descriptor, signal and scheduler ownership remain pending.

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
Native arena access returns EXDEV for these inodes. `host/backing.ts` supplies lazy and resident byte carriers. The object filesystem
facade still owns its original nodes and requires migration.

The untagged ABI 11 inode stride changes to 88 bytes for resident accounting and
payload versions. The VFS image format and process stride remain unchanged.
No release archive or consumer pin uses this candidate layout.

The host directory reader now consumes canonical dentry cursor records. It has
no name-to-node map. Shared host access helpers own synchronous lock/lease
callbacks, with contended lease release retried by the event loop. Existing
`Dir.ent` consumers still require migration to these canonical snapshots.

## Shared hosted instance and identity

`Kern.canonical` now owns one native memory instance. `Proc` reads PID, parent,
process group, credentials, filesystem IDs and umask through its native view.
`Sys` credential setters call native policy. The hosted PID counter and
credential-policy implementation are removed.

RV64 guests load into that same process record and memory. The adapter uses
physical leader harts, allocates secondary harts from canonical status, fences
expired image callbacks and no longer copies guest credentials into host fields.
Host completion retires all bound harts; waiting reaps native resources.

The strict/compiler checkpoint before this migration is
`355b4bbfaf83e1adbf1ceb7a318bad08336e3ce6`: Kernel validation 45334388740 and
Canonical compiler validation 45334388778. The shared-instance candidate
`138f0a0a7bab48e788f6868ef1c0102291bdb700` passed all behavioural tests and
compiler targets; subsequent edits resolve strict guard and type findings.
No final promotion or release is implied.

`Proc` credential getters now return snapshots. Direct field or group-array
mutation is a source compatibility change for the planned major release.
Consumers must use checked syscall operations or trusted loader metadata.

## Canonical host lifecycle and readiness

Hosted `Proc.state` and live exit status read the native process record.
`Sched.ready` snapshots ready native PIDs. The Bun driver retains callback
closures and dispatch counts. Native hart events determine per-thread CPU
readiness.

Ordinary callback completion follows I/O cleanup. A process may be a native
zombie before its host completion promise resolves; the hosted reaper waits
for that completion before releasing its canonical record. Forced termination
can resolve completion earlier: RV64 execution views are expired immediately,
and cancellable host transports remove pending reads. Custom host callbacks
must honour cancellation. Completed status and signal values are retained as
terminal receipts after reaping.

## Signal metadata and aborted host operations

Canonical process fields own the blocked mask, one deferred signal and the
latest delivery. Host callbacks receive delivery through their abort controller.
The supported signal set and one-slot pending semantics match the hosted API.
Full Linux signal-action and rt_sigprocmask syscall coverage remains a separate
integration requirement; the existing RV64 compatibility stubs need review.

An RV64 abort marks the execution view inactive and wakes its pending-operation
loop. Host completion callbacks check that view before accessing registers or
resuming execution. The regression fixture releases an old write after the hart
has been reassigned and checks the new guest's waiting state.

Host pipe and terminal readers now use a shared cancellation queue. Aborting a process removes its pending read without closing inherited stdin; Sys, RV64 and legacy guest adapters pass the process signal. Regression fixtures kill and reap a reader, reuse its hart and verify that the next child and parent retain their input. Custom input providers must implement cancellation for pending reads.

## Inode views

The candidate inode layout includes a separate incarnation token. Host views read canonical metadata under locks and reject recycled slots and remounted filesystems. Checked reads use the live canonical process and credentials. The legacy object filesystem still needs replacement with these views.

`HostBacking` now uses those inode and process views. Lazy provider completion rechecks both identities before committing metadata, covering reaped readers and recycled inode slots.

Directory snapshots use the same checked process/inode views. Native path traversal checks search permission for dot components and follows symlinks before resolving subsequent parent components.

Payload restoration reuses the native backing commit operation with a root-only mode. It preserves image metadata while installing resident or lazy storage; ordinary writes retain their set-ID-clearing behaviour.

## Root image restoration

The host root loader reuses the existing native image serializer and backing commit operation. It restores metadata, hard links, symlinks and lazy providers into canonical tables. Public object VFS and persistence callers still require migration to this loader.

| Root restoration condition | Result |
| --- | --- |
| Resident quota or inode/dentry capacity exceeded | `ENOSPC` before mounting |
| An open descriptor retains an inode | `EBUSY` |
| A process working directory differs from the old root | `EBUSY` |

The exported close operation and mounted RV64 close syscall share descriptor teardown. Both release the final unlinked inode reference, including descriptors whose payload is serviced by a host capability.

Reaping shares descriptor teardown with both close entry points and waits for the process descriptor lock. Unmapping separates range validation, split-capacity checks and mutation; partial-range fixtures cover preserved bytes and file offsets.

Canonical directory changes and path reconstruction use dentries and process cwd inode references. Removing or replacing a referenced directory returns EBUSY. Renaming preserves its inode. The hosted `Proc.cwd` getter delegates to canonical path reconstruction.

## Explicit host capability boundary

`Kern` no longer imports host defaults. Its constructor accepts explicit limits, network and WASI capabilities. RAM discovery and environment overrides moved from `core/cap.ts` to `host/limits.ts`; the `createHostKernel` entry owns host defaults. mikuOS will obtain these services at its host boundary during repinning. The original native kernel graph and the supported host capability implementations remain intact.

`HostInode.symlink` creates a canonical symlink and its target bytes atomically. The production filesystem adapter will use this operation in place of mutable object nodes. Native failures leave no partially published link.

Character-device opens retain native inode and descriptor authority. The explicit host device registry retains only callback capabilities, keyed by live inode incarnation. This is required for migrating `/dev` and `/proc` without an object filesystem or a second permissions implementation.

## Production hosted root cutover

`Kern` mounts its root in the existing canonical memory at construction. `Vfs` is a request facade over that mount and `VNode` subclasses are non-owning inode views. `Sys` uses native inode descriptors for all ordinary files; `Proc.cwd` reads and changes the native cwd reference. `TreeFs` delegates root images to the canonical serializer and loader. RV64 file mapping retention, vfork descriptor snapshots and live overlay reconciliation remain explicit parity gates before promotion.

RV64 eventfd and epoll waits expire on process cancellation or image disposal.
Cancellation removes abort listeners and timers. Resumed operations check the
descriptor incarnation before accessing guest memory. Linux event semantics
remain in the host bridge.

Canonical map records retain the inode and original open rights in previously
unused words. VFS reclamation and remount validation account for mapped inodes.
Split, move, unmap and reaping preserve or release these references. Mapping
mutations share the VFS lock. The RV64 host transport still needs to use the
retained records for file bytes and shared write-back.

RV64 file mappings use retained native inode records for byte transport. The host mapping array and its split/remap metadata are removed. Shared write-back precedes MAP_FIXED replacement and unmap. Successful exec releases file mappings before loading the next image. Dirty-page and concurrent mapping coherence require further validation.

Shared mapping write-back uses a canonical byte bitmap allocated with guest pages. Clean bytes are not copied back over newer inode contents. Native stores, atomic writes and host syscall output share the marking path. Immediate cross-process mapping visibility remains a parity gate.

Shared-file view revisions now live in native mapping records. The cooperative bridge refreshes stale views before execution, publishes dirty batches before dispatch, and uses a native batch boundary for shared aliases. Parallel host transports are not validated by this cooperative test.
