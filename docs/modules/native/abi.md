# Native ABI constants

Offsets are measured in bytes in linear memory. Use the named constants rather than embedding numeric offsets in a host or generated kernel. Status values distinguish completion, waiting, faults and contention; they are not interchangeable with Linux errno codes.

## Control-block offsets

Offsets in the global control block, including locks and backing-store layout.

- `C_MAGIC`
- `C_ABI`
- `C_FLAGS`
- `C_MAX_HARTS`
- `C_ACTIVE_WORKERS`
- `C_ATOMIC_LOCK`
- `C_SCHED_LOCK`
- `C_PROCESS_LOCK`
- `C_VFS_LOCK`
- `C_CREDENTIAL_LOCK`
- `C_MEMORY_LOCK`
- `C_PAGE_TABLE_BASE`
- `C_PAGE_CAPACITY`
- `C_PHYSICAL_FREE`
- `C_PHYSICAL_NEXT`
- `C_PHYSICAL_END`
- `C_PROCESS_TABLE_BASE`
- `C_PROCESS_CAPACITY`
- `C_PROCESS_COUNT`
- `C_NEXT_PID`
- `C_SCHED_CURSOR`
- `C_SCHED_RUNS`
- `C_SCHED_IDLE`
- `C_SCHED_CLAIMS`
- `C_SCHED_CONTENTION`
- `C_WORKER_CAPACITY`
- `C_SEGMENT_TABLE_BASE`
- `C_SEGMENT_CAPACITY`
- `C_IMAGE_TOP`
- `C_IMAGE_LOCK`
- `C_IMAGE_SIZE`
- `C_MAP_TABLE_BASE`
- `C_MAP_CAPACITY`
- `C_VFS_INODE_BASE`
- `C_VFS_INODE_CAPACITY`
- `C_VFS_DENTRY_BASE`
- `C_VFS_DENTRY_CAPACITY`
- `C_VFS_DATA_BASE`
- `C_VFS_DATA_END`
- `C_VFS_DATA_NEXT`
- `C_VFS_INODE_COUNT`
- `C_VFS_DENTRY_COUNT`
- `C_VFS_ROOT`
- `C_VFS_LOADED`
- `C_VFS_DIRTY`
- `C_VFS_GENERATION`
- `C_VFS_SCRATCH_BASE`
- `C_DESCRIPTOR_TABLE_BASE`
- `C_DESCRIPTOR_CAPACITY`
- `C_WORKER_BASE`

## Hart fields

Offsets in a hart record; register storage, PC, events and counters.

- `H_LOCK`
- `H_STATUS`
- `H_EVENT`
- `H_FAULT`
- `H_VIRTUAL_TOP`
- `H_PC`
- `H_RESERVATION`
- `H_FCSR`
- `H_LAST_INSTRUCTION`
- `H_INSTRUCTIONS`
- `H_HOST_TO_WASM`
- `H_WASM_TO_HOST`
- `H_SYNC_WAITS`
- `H_LOCK_CONTENTION`
- `H_MIGRATIONS`
- `H_LAST_WORKER`
- `H_PAGE_TABLE`
- `H_PAGE_CAPACITY`
- `H_PAGE_COUNT`
- `H_X`
- `H_F`
- `H_HOST_OPERATION`
- `H_HOST_DESCRIPTOR`
- `H_HOST_ADDRESS`
- `H_HOST_LENGTH`
- `H_EXIT_CODE`
- `H_PID`
- `H_PPID`
- `H_RUID`
- `H_EUID`
- `H_SUID`
- `H_FSUID`
- `H_RGID`
- `H_EGID`
- `H_SGID`
- `H_FSGID`
- `H_KERNEL_SYSCALLS`
- `H_INTERNAL_SYSCALLS`
- `H_HOST_REQUESTS`
- `H_FALLBACK_SYSCALLS`
- `H_GROUP_COUNT`
- `H_GROUPS`
- `H_PROCESS_SLOT`
- `H_IMAGE_FLOOR`
- `H_IMAGE_LOADS`
- `H_IMAGE_BYTES`
- `H_STACK_BOTTOM`
- `H_STACK_POINTER`
- `H_STARTUP_LOADS`
- `H_FLOAT_SCRATCH`

## Process fields

Offsets in a process record; credentials, page/mapping tables and descriptors.

- `P_LOCK`
- `P_STATE`
- `P_PID`
- `P_PPID`
- `P_PGID`
- `P_EXIT_CODE`
- `P_RUID`
- `P_EUID`
- `P_SUID`
- `P_FSUID`
- `P_RGID`
- `P_EGID`
- `P_SGID`
- `P_FSGID`
- `P_GROUP_DATA`
- `P_GROUP_COUNT`
- `P_GROUPS`
- `P_PAGE_TABLE`
- `P_PAGE_CAPACITY`
- `P_PAGE_COUNT`
- `P_VIRTUAL_TOP`
- `P_SEGMENT_TABLE`
- `P_SEGMENT_COUNT`
- `P_IMAGE_FLOOR`
- `P_IMAGE_ENTRY`
- `P_PHDR`
- `P_PHENT`
- `P_PHNUM`
- `P_STACK_BOTTOM`
- `P_STACK_POINTER`
- `P_MAP_TABLE`
- `P_MAP_COUNT`
- `P_MAP_CAPACITY`
- `P_BRK_BASE`
- `P_BRK`
- `P_MAP_NEXT`
- `P_CWD_INODE`
- `P_UMASK`
- `P_DESCRIPTOR_TABLE`
- `P_DESCRIPTOR_CAPACITY`

## Worker metrics

Offsets for per-worker batch, instruction and idle counters.

- `W_BATCHES`
- `W_INSTRUCTIONS`
- `W_IDLE`

## Descriptor fields

Offsets within one descriptor record.

- `FD_KIND`
- `FD_FLAGS`
- `FD_INODE`
- `FD_IDENTITY`
- `FD_OFFSET`
- `FD_CURSOR`

## Segment fields

Offsets within one executable-segment record.

- `S_ADDRESS`
- `S_END`
- `S_FLAGS`
- `S_NAME_HASH`
- `S_NAME_LENGTH`

## Mapping fields

Offsets within one virtual-memory mapping record.

- `M_ADDRESS`
- `M_END`
- `M_PROTECTION`
- `M_FLAGS`
- `M_FILE_DESCRIPTOR`
- `M_FILE_OFFSET`
- `M_BACKING`

## Inode fields

Offsets in native filesystem inode metadata.

- `V_KIND`
- `V_MODE`
- `V_UID`
- `V_GID`
- `V_NLINK`
- `V_FLAGS`
- `V_SIZE`
- `V_DATA`
- `V_CAPACITY`
- `V_ATIME`
- `V_MTIME`
- `V_CTIME`

## Directory-entry fields

Offsets in native directory-entry records.

- `D_PARENT`
- `D_INODE`
- `D_NAME`
- `D_NAME_LENGTH`
- `D_NAME_HASH`
- `D_FLAGS`

## Status, limits and layout

ABI identities, fixed region sizes, status/error values, flags and capacities used by native callers.

- `THISTLE_MAGIC`
- `THISTLE_ABI_VERSION`
- `THISTLE_CONTROL_BASE`
- `THISTLE_CONTROL_SIZE`
- `THISTLE_HART_BASE`
- `THISTLE_HART_STRIDE`
- `THISTLE_WORKER_STRIDE`
- `THISTLE_FLAG_THREADED`
- `THISTLE_FLAG_HOST_STDIN`
- `THISTLE_FLAG_HOST_TRANSPORT`
- `THISTLE_GROUP_CAPACITY`
- `THISTLE_PROCESS_STRIDE`
- `THISTLE_DESCRIPTOR_STRIDE`
- `THISTLE_DESCRIPTOR_CAPACITY`
- `THISTLE_FD_EMPTY`
- `THISTLE_FD_HOST`
- `THISTLE_FD_FILE`
- `THISTLE_FD_DIRECTORY`
- `THISTLE_FD_READ`
- `THISTLE_FD_WRITE`
- `THISTLE_FD_APPEND`
- `THISTLE_FD_CLOEXEC`
- `THISTLE_VFS_PATH_CAPACITY`
- `THISTLE_SEGMENT_STRIDE`
- `THISTLE_SEGMENT_CAPACITY`
- `THISTLE_SEGMENT_READ`
- `THISTLE_SEGMENT_WRITE`
- `THISTLE_SEGMENT_EXECUTE`
- `THISTLE_MAP_STRIDE`
- `THISTLE_MAP_CAPACITY`
- `THISTLE_MAP_BACKING_ANONYMOUS`
- `THISTLE_VFS_INODE_STRIDE`
- `THISTLE_VFS_INODE_CAPACITY`
- `THISTLE_VFS_DENTRY_STRIDE`
- `THISTLE_VFS_DENTRY_CAPACITY`
- `THISTLE_VFS_DATA_CAPACITY`
- `THISTLE_VFS_MAX_INODE_CAPACITY`
- `THISTLE_VFS_MAX_DENTRY_CAPACITY`
- `THISTLE_VFS_MAX_DATA_CAPACITY`
- `THISTLE_VFS_MAX_IMAGE_SIZE`
- `THISTLE_VFS_KIND_EMPTY`
- `THISTLE_VFS_KIND_FILE`
- `THISTLE_VFS_KIND_DIRECTORY`
- `THISTLE_VFS_KIND_LINK`
- `THISTLE_VFS_KIND_CHARACTER`
- `THISTLE_VFS_IMAGE_MAGIC`
- `THISTLE_VFS_IMAGE_VERSION`
- `THISTLE_VFS_OK`
- `THISTLE_VFS_RANGE`
- `THISTLE_VFS_FORMAT`
- `THISTLE_VFS_CHECKSUM`
- `THISTLE_VFS_CAPACITY_ERROR`
- `THISTLE_VFS_DUPLICATE`
- `THISTLE_PARSER_BASE`
- `THISTLE_PARSER_STRING`
- `THISTLE_PARSER_STRING_LENGTH`
- `THISTLE_PARSER_STRING_ESCAPED`
- `THISTLE_PARSER_NUMBER`
- `THISTLE_PROCESS_EMPTY`
- `THISTLE_PROCESS_RUNNABLE`
- `THISTLE_PROCESS_WAITING`
- `THISTLE_PROCESS_ZOMBIE`
- `THISTLE_GUEST_PAGE_SIZE`
- `THISTLE_PAGE_ENTRY_SIZE`
- `THISTLE_PAGE_CAPACITY`
- `THISTLE_HART_EMPTY`
- `THISTLE_HART_RUNNABLE`
- `THISTLE_HART_WAITING`
- `THISTLE_HART_EXITED`
- `THISTLE_HART_FAULTED`
- `THISTLE_EVENT_NONE`
- `THISTLE_EVENT_SYSCALL`
- `THISTLE_EVENT_HOST`
- `THISTLE_HOST_NONE`
- `THISTLE_HOST_WRITE`
- `THISTLE_HOST_READ`
- `THISTLE_BATCH_BUDGET`
- `THISTLE_BATCH_SYSCALL`
- `THISTLE_BATCH_HOST`
- `THISTLE_BATCH_EXITED`
- `THISTLE_BATCH_FAULT`
- `THISTLE_BATCH_BUSY`
- `THISTLE_BATCH_CONTENDED`
- `THISTLE_FAULT_NONE`
- `THISTLE_FAULT_MEMORY`
- `THISTLE_FAULT_INSTRUCTION`
- `THISTLE_FAULT_BREAKPOINT`
- `THISTLE_FAULT_BAD_STATE`
- `THISTLE_THX_OK`
- `THISTLE_THX_BUSY`
- `THISTLE_THX_RANGE`
- `THISTLE_THX_MAGIC`
- `THISTLE_THX_LENGTH`
- `THISTLE_THX_CHECKSUM`
- `THISTLE_THX_JSON`
- `THISTLE_THX_METADATA`
- `THISTLE_THX_SECTION`
- `THISTLE_THX_MEMORY`
- `THISTLE_STARTUP_MAGIC`
- `THISTLE_START_OK`
- `THISTLE_START_RANGE`
- `THISTLE_START_FORMAT`
- `THISTLE_START_MEMORY`

`THISTLE_MAP_BACKING_HOST_FILE` marks mappings whose bytes are backed by the hosted live VFS. These mappings delegate munmap so shared writes are flushed before frames are released.

`C_PHYSICAL_FREE` points to the list of recycled guest frames in unused control-block space. Each free frame stores the next pointer in its first word. Allocation zeroes the frame before publishing a guest page.

| ABI 11 layout | Value |
| --- | --- |
| `P_GROUP_DATA` extension head | Offset 344 |
| Process stride | 352 bytes |
| Inline supplementary IDs | 32 |
| Previous memory ABI | 10; rejected by ABI 11 validation |

| Additional ABI 11 field | Layout |
| --- | --- |
| `C_VFS_QUOTA` | Control offset 3368, u64 resident-byte limit |
| `V_RESIDENT` | Inode offset 64, u64 host-resident bytes |
| `V_VERSION` | Inode offset 72, u64 payload revision |
| `THISTLE_VFS_HOST_BACKING` | Inode flag 1; `V_DATA` is an opaque host carrier handle |
| `V_IDENTITY` | Inode offset 80, u64 incarnation token |
| `THISTLE_VFS_INODE_STRIDE` | 88 bytes; VFS image format remains unchanged |

`P_LEADER_HART` occupies process offset 348 in the untagged ABI 11 layout.

| Canonical process phase | Value |
| --- | --- |
| `THISTLE_PROCESS_RUNNABLE` | 1, ready |
| `THISTLE_PROCESS_WAITING` | 2, waiting |
| `THISTLE_PROCESS_ZOMBIE` | 3, exited |
| `THISTLE_PROCESS_RUNNING` | 4, host callback running |
| `THISTLE_PROCESS_STOPPED` | 5, stopped phase |

Hart status and events determine CPU readiness within a process. Updating a
host callback phase does not park sibling guest harts.

| Signal field in the existing ABI 11 process stride | Layout |
| --- | --- |
| `P_SIGNAL_PENDING` | Offset 328, one deferred supported signal |
| `P_SIGNAL_LAST` | Offset 332, most recently delivered signal |
| `P_SIGNAL_MASK` | Offset 336, unsigned 64-bit blocked mask |

Candidate ABI 11 uses an 88-byte inode stride. `V_IDENTITY` at byte 80 identifies one incarnation of an inode slot independently of its mutable payload version. The on-disk image retains 56-byte inode records.

`THISTLE_VFS_BUSY` is mount status 6. It reports retained file descriptors or a process working directory below the current root.

Default VFS: 8192 inode slots, 16384 directory-entry slots. Reference mikuOS root: 4668 inodes, maximum ID 4679. `thistleKernelInitWithVfs` accepts explicit capacities.

Each process has 256 descriptor slots of 32 bytes. The identity at offset 12 changes on allocation and survives close until the slot is reused. Exhausted identities are not recycled within a process lifetime.

`THISTLE_FLAG_HOST_TRANSPORT` advertises host byte/stream transport for a mounted filesystem. It does not select a separate kernel or change inode authority.

`M_INODE` retains the mapped inode independently of the original descriptor. `M_FILE_RIGHTS` records the open read/write rights. Both occupy reserved words; the map stride is unchanged.

`PAGE_DIRTY_FRAME` is the auxiliary bitmap-frame pointer in a sparse guest page entry. Zero means no bitmap has been allocated.

`P_SHARED_FILE_MAPS` records whether any writable shared file mapping is present. It is refreshed by mapping mutation and cleared on image reset.

`M_VIEW_VERSION` retains the last materialised inode payload revision in each mapping. Mapping records now occupy 56 bytes in the unreleased candidate ABI. `H_SHARED_WRITE` marks a batch containing mapped writes. `P_SHARED_FILE_MAPS` uses bit 0 for shared views, bit 1 for retained shared write rights and bit 2 for multiple shared views.
