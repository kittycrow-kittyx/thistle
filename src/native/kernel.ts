import { bindProcess, INVALID_POINTER, hartAt, processAt, processForHart, processSlotByPid, validHart, validKernel } from "./state.js";
import { inputContains, allocateFrame, validProcessFrames, releaseProcessFrames, trimFreeFrames } from "./arena.js";
import { updateIdentity, readGroup, replaceGroups } from "./credentials.js";
import { rv64Branch, rv64RegisterWordValid, rv64RegisterWordValue, rv64ImmediateWordValid, rv64ImmediateWordValue, rv64ImmediateOpValid, rv64ImmediateOpValue, rv64RegisterValid, rv64RegisterValue, rv64FloatClass, rv64CompressedJump, rv64ImmediateB, rv64ImmediateI, rv64ImmediateJ, rv64ImmediateS, rv64ImmediateU } from "../core/rv64-decode.js";
import {
  C_ABI,
  C_ACTIVE_WORKERS,
  C_ATOMIC_LOCK,
  C_CREDENTIAL_LOCK,
  C_DESCRIPTOR_CAPACITY,
  C_DESCRIPTOR_TABLE_BASE,
  C_FLAGS,
  C_MAGIC,
  C_MAX_HARTS,
  C_IMAGE_LOCK,
  C_IMAGE_SIZE,
  C_IMAGE_TOP,
  C_MEMORY_LOCK,
  C_MAP_CAPACITY,
  C_MAP_TABLE_BASE,
  C_VFS_DATA_BASE,
  C_VFS_DATA_END,
  C_VFS_DATA_NEXT,
  C_VFS_DENTRY_BASE,
  C_VFS_DENTRY_CAPACITY,
  C_VFS_DENTRY_COUNT,
  C_VFS_DIRTY,
  C_VFS_GENERATION,
  C_VFS_INODE_BASE,
  C_VFS_INODE_CAPACITY,
  C_VFS_INODE_COUNT,
  C_VFS_LOADED,
  C_VFS_ROOT,
  C_VFS_LOCK,
  C_VFS_SCRATCH_BASE,
  C_PAGE_CAPACITY,
  C_PAGE_TABLE_BASE,
  C_PHYSICAL_END,
  C_PHYSICAL_NEXT,
  C_PHYSICAL_FREE,
  C_PROCESS_CAPACITY,
  C_PROCESS_COUNT,
  C_PROCESS_LOCK,
  C_PROCESS_TABLE_BASE,
  C_NEXT_PID,
  C_SCHED_CLAIMS,
  C_SCHED_CONTENTION,
  C_SCHED_CURSOR,
  C_SCHED_IDLE,
  C_SCHED_LOCK,
  C_SCHED_RUNS,
  C_SEGMENT_CAPACITY,
  C_SEGMENT_TABLE_BASE,
  C_WORKER_BASE,
  C_WORKER_CAPACITY,
  H_EVENT,
  H_EGID,
  H_EUID,
  H_EXIT_CODE,
  H_FALLBACK_SYSCALLS,
  H_FAULT,
  H_F,
  H_FCSR,
  H_FLOAT_SCRATCH,
  H_HOST_TO_WASM,
  H_HOST_ADDRESS,
  H_HOST_DESCRIPTOR,
  H_HOST_LENGTH,
  H_HOST_OPERATION,
  H_HOST_REQUESTS,
  H_INTERNAL_SYSCALLS,
  H_INSTRUCTIONS,
  H_IMAGE_BYTES,
  H_IMAGE_FLOOR,
  H_IMAGE_LOADS,
  H_STACK_BOTTOM,
  H_STACK_POINTER,
  H_STARTUP_LOADS,
  H_KERNEL_SYSCALLS,
  H_LAST_INSTRUCTION,
  H_LAST_WORKER,
  H_LOCK,
  H_LOCK_CONTENTION,
  H_MIGRATIONS,
  H_PAGE_CAPACITY,
  H_PAGE_COUNT,
  H_PAGE_TABLE,
  H_PC,
  H_PROCESS_SLOT,
  H_PID,
  H_PPID,
  H_RGID,
  H_RUID,
  H_SGID,
  H_SUID,
  H_FSGID,
  H_FSUID,
  H_RESERVATION,
  H_STATUS,
  H_SYNC_WAITS,
  H_VIRTUAL_TOP,
  H_WASM_TO_HOST,
  H_X,
  THISTLE_ABI_VERSION,
  THISTLE_BATCH_BUDGET,
  THISTLE_BATCH_BUSY,
  THISTLE_BATCH_CONTENDED,
  THISTLE_BATCH_EXITED,
  THISTLE_BATCH_FAULT,
  THISTLE_BATCH_HOST,
  THISTLE_BATCH_SYSCALL,
  THISTLE_CONTROL_BASE,
  THISTLE_CONTROL_SIZE,
  THISTLE_EVENT_NONE,
  THISTLE_EVENT_HOST,
  THISTLE_EVENT_SYSCALL,
  THISTLE_FAULT_BAD_STATE,
  THISTLE_FAULT_BREAKPOINT,
  THISTLE_FAULT_INSTRUCTION,
  THISTLE_FAULT_MEMORY,
  THISTLE_FLAG_THREADED,
  THISTLE_FLAG_HOST_STDIN,
  THISTLE_GUEST_PAGE_SIZE,
  THISTLE_HART_BASE,
  THISTLE_HART_EMPTY,
  THISTLE_HART_EXITED,
  THISTLE_HART_FAULTED,
  THISTLE_HART_RUNNABLE,
  THISTLE_HART_STRIDE,
  THISTLE_HART_WAITING,
  THISTLE_HOST_NONE,
  THISTLE_HOST_WRITE,
  THISTLE_HOST_READ,
  THISTLE_MAGIC,
  THISTLE_PAGE_CAPACITY,
  THISTLE_PAGE_ENTRY_SIZE,
  THISTLE_PROCESS_EMPTY,
  THISTLE_PROCESS_RUNNABLE,
  THISTLE_PROCESS_STRIDE,
  THISTLE_PROCESS_WAITING,
  THISTLE_PROCESS_ZOMBIE,
  THISTLE_WORKER_STRIDE,
  W_BATCHES,
  W_IDLE,
  W_INSTRUCTIONS,
  P_EGID,
  P_EUID,
  P_EXIT_CODE,
  P_FSGID,
  P_FSUID,
  P_GROUP_COUNT,
  P_PGID,
  P_PAGE_CAPACITY,
  P_PAGE_COUNT,
  P_PAGE_TABLE,
  P_PID,
  P_PPID,
  P_RGID,
  P_RUID,
  P_SGID,
  P_STATE,
  P_SUID,
  P_IMAGE_ENTRY,
  P_IMAGE_FLOOR,
  P_BRK,
  P_BRK_BASE,
  P_CWD_INODE,
  P_DESCRIPTOR_TABLE,
  P_DESCRIPTOR_CAPACITY,
  P_LOCK, P_LEADER_HART,
  P_MAP_CAPACITY,
  P_MAP_COUNT,
  P_MAP_NEXT,
  P_MAP_TABLE,
  P_UMASK,
  P_PHDR,
  P_PHENT,
  P_PHNUM,
  P_SEGMENT_COUNT,
  P_SEGMENT_TABLE,
  P_STACK_BOTTOM,
  P_STACK_POINTER,
  P_VIRTUAL_TOP,
  S_ADDRESS,
  S_END,
  S_FLAGS,
  S_NAME_HASH,
  S_NAME_LENGTH,
  THISTLE_SEGMENT_CAPACITY,
  THISTLE_SEGMENT_EXECUTE,
  THISTLE_SEGMENT_READ,
  THISTLE_SEGMENT_STRIDE,
  THISTLE_SEGMENT_WRITE,
  M_ADDRESS,
  M_BACKING,
  M_END,
  M_FILE_DESCRIPTOR,
  M_FILE_OFFSET,
  M_FLAGS,
  M_PROTECTION,
  THISTLE_MAP_BACKING_ANONYMOUS,
  THISTLE_MAP_BACKING_HOST_FILE,
  THISTLE_MAP_CAPACITY,
  THISTLE_MAP_STRIDE,
  FD_INODE,
  FD_KIND,
  FD_OFFSET,
  THISTLE_DESCRIPTOR_CAPACITY,
  THISTLE_DESCRIPTOR_STRIDE,
  THISTLE_FD_CLOEXEC,
  THISTLE_FD_DIRECTORY,
  THISTLE_FD_EMPTY,
  THISTLE_FD_HOST,
  THISTLE_FD_READ,
  THISTLE_FD_WRITE,
  THISTLE_VFS_DATA_CAPACITY,
  THISTLE_VFS_DENTRY_CAPACITY,
  THISTLE_VFS_DENTRY_STRIDE,
  THISTLE_VFS_INODE_CAPACITY,
  THISTLE_VFS_INODE_STRIDE,
  THISTLE_VFS_MAX_INODE_CAPACITY,
  THISTLE_VFS_MAX_DENTRY_CAPACITY,
  THISTLE_VFS_MAX_DATA_CAPACITY,
  THISTLE_VFS_KIND_DIRECTORY,
  THISTLE_VFS_PATH_CAPACITY,
  THISTLE_START_FORMAT,
  THISTLE_START_MEMORY,
  THISTLE_START_OK,
  THISTLE_START_RANGE,
  THISTLE_THX_BUSY,
  THISTLE_THX_MEMORY,
  THISTLE_THX_OK,
  THISTLE_THX_RANGE,
  THISTLE_THX_SECTION,
} from "./abi.js";
import {
  atomicAddI32,
  atomicAddU64,
  atomicLoadI32,
  atomicLoadU64,
  atomicStoreU64,
  atomicStoreI32,
  compareExchangeI32,
  copyMemory,
  fill,
  loadI16,
  loadI32,
  loadI64,
  loadI8,
  loadU16,
  loadU32,
  loadU64,
  loadU8,
  memorySize as memorySizeOf,
  storeI32,
  storeI64,
  storeU16,
  storeU32,
  storeU64,
  storeU8,
} from "./memory.js";
import type { ThistleMemory } from "./memory.js";
import type { F64, I32, I64, Ptr, U32, U64 } from "./types.js";
import {
  divSigned, divUnsigned, mulHighSigned, mulHighSignedUnsigned, mulHighUnsigned, remSigned, remUnsigned,
  bitsToF32,
  bitsToF64,
  f32ToBits,
  f64ToBits,
  floatCeil,
  floatFloor,
  floatIsNaN,
  floatMax,
  floatMin,
  floatSqrt,
  floatToI64,
  floatToU64,
  floatTrunc,
  roundF32,
  sx,
  u32word,
  ux,
  word,
  wordToI32,
  wordToPtr,
  wordToU32,
  wordToFloat,
  unsignedWordToFloat,
} from "./word.js";
import {
  descriptorAt, releaseDescriptor, installDescriptor, thistleVfsOpenInode, descriptorReadStatus, descriptorReadCount, thistleVfsReadDescriptor, thistleVfsSeekDescriptor,
  thistleVfsAccess,
  thistleVfsFileSize,
  thistleVfsKind,
  thistleVfsReadScratch,
  thistleVfsLoaded,
  thistleVfsResolve,
  thistleVfsRoot,
} from "./vfs.js";

const NO_RESERVATION: I64 = -1n;
const UNMAPPED_POINTER: Ptr = 0xfffffffe;
const INVALID_PROCESS: U32 = 0xffffffff;
const MAP_NOT_OWNED: I64 = -4096n;
const MAP_PAGE: U64 = 4096n;
const MAP_GUARD: U64 = 1024n * 1024n;
const MAP_SPACING: U64 = 16n * 1024n * 1024n;

/** Diagnostic ring in the unused portion of the control page for <=32 harts. */
const MMAP_TRACE_COUNTER: Ptr = 1000;
const MMAP_TRACE_BASE: Ptr = 1024;
const MMAP_TRACE_STRIDE: U32 = 40;
const MMAP_TRACE_CAPACITY: U32 = 48;
const MMAP_TRACE_START: U64 = 0x400000000n;
const MMAP_TRACE_END: U64 = 0x500000000n;

const traceMappingOperation = (memory: ThistleMemory, hart: U32, operation: U32, result: I64): void => {
  // Syscall argument registers are still live until internalSyscall writes the result.
  const address = ux(x(memory, hart, 10));
  const length = ux(x(memory, hart, 11));
  const options = operation === 215 ? 0 : wordToU32(ux(x(memory, hart, operation === 222 ? 13 : 12)));
  const detail = operation === 215 ? 0n : ux(x(memory, hart, operation === 222 ? 12 : 13));
  // The debug area follows worker metrics and must not overlap them.
  if (loadU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY) > 32) return;
  const mapped = operation === 222 && result >= 0n ? ux(result) : address;
  const requested = address < MMAP_TRACE_END && address + length > MMAP_TRACE_START;
  const affected = mapped < MMAP_TRACE_END && mapped + length > MMAP_TRACE_START;
  if (!requested && !affected) return;
  const count = loadU32(memory, THISTLE_CONTROL_BASE + MMAP_TRACE_COUNTER);
  const slot = THISTLE_CONTROL_BASE + MMAP_TRACE_BASE + count % MMAP_TRACE_CAPACITY * MMAP_TRACE_STRIDE;
  storeU32(memory, slot, operation);
  storeU32(memory, slot + 4, options);
  storeU64(memory, slot + 8, address);
  storeU64(memory, slot + 16, length);
  storeI64(memory, slot + 24, result);
  storeU64(memory, slot + 32, detail);
  storeU32(memory, THISTLE_CONTROL_BASE + MMAP_TRACE_COUNTER, count + 1);
};

/** Diagnose V8 Smi-like values stored in the top 64 KiB of the guest stack.
 * The stack address varies between runs, so no absolute cell is hardcoded.
 * Record only compact integer-tagged writes to avoid burying the relevant PC. */
const traceNodePointerWrite = (
  memory: ThistleMemory, hart: U32, address: U64, value: U64, size: U32,
): void => {
  if (loadU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY) > 32) return;
  const top = loadU64(memory, hartAt(hart) + H_VIRTUAL_TOP);
  if (top < 0x10000n || address < top - 0x10000n || address >= top) return;
  const low = value & 0xffffffffn;
  const high = value >> 32n;
  const fullSmi = size === 8 && low === 0n && high > 0n && high <= 16n;
  const upperSmi = size === 4 && (address & 7n) === 4n && low > 0n && low <= 16n;
  if (!fullSmi && !upperSmi) return;
  const count = loadU32(memory, THISTLE_CONTROL_BASE + MMAP_TRACE_COUNTER);
  const slot = THISTLE_CONTROL_BASE + MMAP_TRACE_BASE + count % MMAP_TRACE_CAPACITY * MMAP_TRACE_STRIDE;
  storeU32(memory, slot, 0x53544f52);
  storeU32(memory, slot + 4, size);
  storeU64(memory, slot + 8, address);
  storeU64(memory, slot + 16, ux(word(size)));
  storeI64(memory, slot + 24, sx(value, 64));
  storeU64(memory, slot + 32, loadU64(memory, hartAt(hart) + H_PC));
  storeU32(memory, THISTLE_CONTROL_BASE + MMAP_TRACE_COUNTER, count + 1);
};

const OPEN_DIRECTORY: U32 = 0x10000;
const OPEN_CLOEXEC: U32 = 0x80000;

const regAt = (hart: U32, register: U32): Ptr => hartAt(hart) + H_X + register * 8;
const floatRegAt = (hart: U32, register: U32): Ptr => hartAt(hart) + H_F + register * 8;
const pageAlign = (value: U32): U32 => (value + THISTLE_GUEST_PAGE_SIZE - 1) & -THISTLE_GUEST_PAGE_SIZE;
/** Secondary harts are relative to their own process leader, not hart zero. */
const sharedProcessThread = (memory: ThistleMemory, hart: U32): boolean => {
  const proc = processForHart(memory, hart);
  return proc !== INVALID_POINTER && loadU32(memory, proc + P_LEADER_HART) !== hart;
};

const workerAt = (worker: U32): Ptr => C_WORKER_BASE + worker * THISTLE_WORKER_STRIDE;


const bump = (memory: ThistleMemory, at: Ptr): void => {
  atomicAddU64(memory, at, 1n);
};

const acquire = (memory: ThistleMemory, at: Ptr): boolean =>
  compareExchangeI32(memory, at, 0, 1) === 0;

const release = (memory: ThistleMemory, at: Ptr): void => atomicStoreI32(memory, at, 0);

export const thistleKernelInit = (memory: ThistleMemory, maxHarts: U32, threaded: boolean): I32 =>
  thistleKernelInitWithVfs(memory, maxHarts, threaded, THISTLE_VFS_INODE_CAPACITY, THISTLE_VFS_DENTRY_CAPACITY, THISTLE_VFS_DATA_CAPACITY);

export const thistleKernelInitWithVfs = (
  memory: ThistleMemory, maxHarts: U32, threaded: boolean,
  inodeCapacity: U32, dentryCapacity: U32, dataCapacity: U32,
): I32 => {
  // Bound each metadata table before computing its byte size and align every table to a guest page.
  // The physical allocator begins after VFS data, so at least one guest frame must remain.
  if (inodeCapacity < 2 || inodeCapacity > THISTLE_VFS_MAX_INODE_CAPACITY ||
      dentryCapacity < 1 || dentryCapacity > THISTLE_VFS_MAX_DENTRY_CAPACITY ||
      dataCapacity < 4096 || dataCapacity > THISTLE_VFS_MAX_DATA_CAPACITY) return THISTLE_FAULT_BAD_STATE;
  if (maxHarts < 1 || maxHarts > 1024) return THISTLE_FAULT_BAD_STATE;
  const hartEnd = THISTLE_HART_BASE + maxHarts * THISTLE_HART_STRIDE;
  const processCapacity = maxHarts > 32 ? 256 : maxHarts * 8;
  const pageTables = pageAlign(hartEnd);
  const tableBytes = processCapacity * THISTLE_PAGE_CAPACITY * THISTLE_PAGE_ENTRY_SIZE;
  const segmentTables = pageAlign(pageTables + tableBytes);
  const segmentBytes = processCapacity * THISTLE_SEGMENT_CAPACITY * THISTLE_SEGMENT_STRIDE;
  const mapTables = pageAlign(segmentTables + segmentBytes);
  const mapBytes = processCapacity * THISTLE_MAP_CAPACITY * THISTLE_MAP_STRIDE;
  const vfsScratch = pageAlign(mapTables + mapBytes);
  const inodeTable = pageAlign(vfsScratch + THISTLE_VFS_PATH_CAPACITY);
  const dentryTable = pageAlign(inodeTable + inodeCapacity * THISTLE_VFS_INODE_STRIDE);
  const descriptorTables = pageAlign(dentryTable + dentryCapacity * THISTLE_VFS_DENTRY_STRIDE);
  const descriptorBytes = processCapacity * THISTLE_DESCRIPTOR_CAPACITY * THISTLE_DESCRIPTOR_STRIDE;
  const processTable = pageAlign(descriptorTables + descriptorBytes);
  const vfsData = pageAlign(processTable + processCapacity * THISTLE_PROCESS_STRIDE);
  const physical = pageAlign(vfsData + dataCapacity);
  const total = memorySizeOf(memory);
  if (physical < pageTables || physical > total || total - physical < THISTLE_GUEST_PAGE_SIZE) return THISTLE_FAULT_MEMORY;
  // Initialise all metadata before publishing the magic and table offsets to other harts.
  fill(memory, THISTLE_CONTROL_BASE, physical, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_MAGIC, THISTLE_MAGIC);
  storeU32(memory, THISTLE_CONTROL_BASE + C_ABI, THISTLE_ABI_VERSION);
  storeU32(memory, THISTLE_CONTROL_BASE + C_FLAGS, threaded ? THISTLE_FLAG_THREADED : 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_MAX_HARTS, maxHarts);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PAGE_TABLE_BASE, pageTables);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PAGE_CAPACITY, THISTLE_PAGE_CAPACITY);
  storeU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_TABLE_BASE, segmentTables);
  storeU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_CAPACITY, THISTLE_SEGMENT_CAPACITY);
  storeU32(memory, THISTLE_CONTROL_BASE + C_MAP_TABLE_BASE, mapTables);
  storeU32(memory, THISTLE_CONTROL_BASE + C_MAP_CAPACITY, THISTLE_MAP_CAPACITY);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_SCRATCH_BASE, vfsScratch);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_BASE, inodeTable);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_CAPACITY, inodeCapacity);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_BASE, dentryTable);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_CAPACITY, dentryCapacity);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_BASE, vfsData);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_END, vfsData + dataCapacity);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DATA_NEXT, vfsData);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_INODE_COUNT, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DENTRY_COUNT, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_ROOT, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_LOADED, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_VFS_DIRTY, 0);
  storeU64(memory, THISTLE_CONTROL_BASE + C_VFS_GENERATION, 0n);
  storeU32(memory, THISTLE_CONTROL_BASE + C_DESCRIPTOR_TABLE_BASE, descriptorTables);
  storeU32(memory, THISTLE_CONTROL_BASE + C_DESCRIPTOR_CAPACITY, THISTLE_DESCRIPTOR_CAPACITY);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PHYSICAL_NEXT, physical);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PHYSICAL_END, total);
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_TOP, total);
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_SIZE, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_TABLE_BASE, processTable);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_CAPACITY, processCapacity);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_COUNT, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_NEXT_PID, 2);
  storeU32(memory, THISTLE_CONTROL_BASE + C_SCHED_CURSOR, 0);
  storeU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY, maxHarts > 128 ? 128 : maxHarts);
  return 0;
};

export const thistleKernelValid = (memory: ThistleMemory): boolean => validKernel(memory);

export const thistleHartInit = (
  memory: ThistleMemory,
  hart: U32,
  virtualTop: U64,
  pc: U64,
): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart) || processForHart(memory, hart) !== INVALID_POINTER) return THISTLE_FAULT_BAD_STATE;
  if (virtualTop < 1024n * 1024n || virtualTop > 0x0000ffffffffffffn || pc >= virtualTop) return THISTLE_FAULT_MEMORY;
  const at = hartAt(hart);
  const capacity = loadU32(memory, THISTLE_CONTROL_BASE + C_PAGE_CAPACITY);
  fill(memory, at, THISTLE_HART_STRIDE, 0);
  storeU64(memory, at + H_VIRTUAL_TOP, virtualTop);
  storeU32(memory, at + H_PAGE_TABLE, INVALID_POINTER);
  storeU32(memory, at + H_PAGE_CAPACITY, capacity);
  storeU32(memory, at + H_PAGE_COUNT, 0);
  storeU64(memory, at + H_PC, pc);
  storeI64(memory, at + H_RESERVATION, NO_RESERVATION);
  storeI32(memory, at + H_LAST_WORKER, -1);
  storeU32(memory, at + H_PROCESS_SLOT, INVALID_PROCESS);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_RUNNABLE);
  return 0;
};

//@cg-expect-error
export const thistleProcessInit = (
  memory: ThistleMemory,
  hart: U32,
  pid: U32,
  ppid: U32,
  ruid: U32,
  euid: U32,
  suid: U32,
  rgid: U32,
  egid: U32,
  sgid: U32,
): I32 => {
  if (!validKernel(memory) || !validHart(memory, hart) || pid < 1 || pid >= INVALID_PROCESS ||
      loadU32(memory, hartAt(hart) + H_STATUS) !== THISTLE_HART_RUNNABLE ||
      loadU32(memory, hartAt(hart) + H_PROCESS_SLOT) !== INVALID_PROCESS) return THISTLE_FAULT_BAD_STATE;
  const lock = THISTLE_CONTROL_BASE + C_PROCESS_LOCK;
  if (!acquire(memory, lock)) return THISTLE_BATCH_CONTENDED;
  const capacity = loadU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_CAPACITY);
  let slot = INVALID_PROCESS;
  let index: U32 = 0;
  while (index < capacity) {
    const proc = processAt(memory, index);
    const state = atomicLoadI32(memory, proc + P_STATE);
    if (state !== THISTLE_PROCESS_EMPTY && loadU32(memory, proc + P_PID) === pid) {
      release(memory, lock);
      return THISTLE_FAULT_BAD_STATE;
    }
    if (state === THISTLE_PROCESS_EMPTY && slot === INVALID_PROCESS) slot = index;
    index += 1;
  }
  if (slot === INVALID_PROCESS) {
    release(memory, lock);
    return THISTLE_FAULT_MEMORY;
  }
  const proc = processAt(memory, slot);
  const pageCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_PAGE_CAPACITY);
  const pageTable = loadU32(memory, THISTLE_CONTROL_BASE + C_PAGE_TABLE_BASE) + slot * pageCapacity * THISTLE_PAGE_ENTRY_SIZE;
  const segmentCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_CAPACITY);
  const segmentTable = loadU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_TABLE_BASE) + slot * segmentCapacity * THISTLE_SEGMENT_STRIDE;
  const mapCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_MAP_CAPACITY);
  const mapTable = loadU32(memory, THISTLE_CONTROL_BASE + C_MAP_TABLE_BASE) + slot * mapCapacity * THISTLE_MAP_STRIDE;
  const descriptorCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_DESCRIPTOR_CAPACITY);
  const descriptorTable = loadU32(memory, THISTLE_CONTROL_BASE + C_DESCRIPTOR_TABLE_BASE) +
    slot * descriptorCapacity * THISTLE_DESCRIPTOR_STRIDE;
  const virtualTop = loadU64(memory, hartAt(hart) + H_VIRTUAL_TOP);
  fill(memory, proc, THISTLE_PROCESS_STRIDE, 0);
  fill(memory, pageTable, pageCapacity * THISTLE_PAGE_ENTRY_SIZE, 0);
  fill(memory, segmentTable, segmentCapacity * THISTLE_SEGMENT_STRIDE, 0);
  fill(memory, mapTable, mapCapacity * THISTLE_MAP_STRIDE, 0);
  fill(memory, descriptorTable, descriptorCapacity * THISTLE_DESCRIPTOR_STRIDE, 0);
  storeU32(memory, proc + P_LEADER_HART, hart);
  atomicStoreI32(memory, proc + P_PID, wordToI32(word(pid)));
  atomicStoreI32(memory, proc + P_PPID, wordToI32(word(ppid)));
  atomicStoreI32(memory, proc + P_PGID, wordToI32(word(pid)));
  atomicStoreI32(memory, proc + P_RUID, wordToI32(word(ruid)));
  atomicStoreI32(memory, proc + P_EUID, wordToI32(word(euid)));
  atomicStoreI32(memory, proc + P_SUID, wordToI32(word(suid)));
  atomicStoreI32(memory, proc + P_FSUID, wordToI32(word(euid)));
  atomicStoreI32(memory, proc + P_RGID, wordToI32(word(rgid)));
  atomicStoreI32(memory, proc + P_EGID, wordToI32(word(egid)));
  atomicStoreI32(memory, proc + P_SGID, wordToI32(word(sgid)));
  atomicStoreI32(memory, proc + P_FSGID, wordToI32(word(egid)));
  atomicStoreI32(memory, proc + P_PAGE_TABLE, wordToI32(word(pageTable)));
  atomicStoreI32(memory, proc + P_PAGE_CAPACITY, wordToI32(word(pageCapacity)));
  atomicStoreI32(memory, proc + P_PAGE_COUNT, 0);
  atomicStoreU64(memory, proc + P_VIRTUAL_TOP, virtualTop);
  atomicStoreI32(memory, proc + P_SEGMENT_TABLE, wordToI32(word(segmentTable)));
  atomicStoreI32(memory, proc + P_SEGMENT_COUNT, 0);
  atomicStoreI32(memory, proc + P_MAP_TABLE, wordToI32(word(mapTable)));
  atomicStoreI32(memory, proc + P_MAP_COUNT, 0);
  atomicStoreI32(memory, proc + P_MAP_CAPACITY, wordToI32(word(mapCapacity)));
  atomicStoreU64(memory, proc + P_MAP_NEXT, 0x4000000000n);
  atomicStoreI32(memory, proc + P_CWD_INODE, wordToI32(word(thistleVfsRoot(memory))));
  atomicStoreI32(memory, proc + P_UMASK, 0o022);
  atomicStoreI32(memory, proc + P_DESCRIPTOR_TABLE, wordToI32(word(descriptorTable)));
  atomicStoreI32(memory, proc + P_DESCRIPTOR_CAPACITY, wordToI32(word(descriptorCapacity)));
  installDescriptor(memory, descriptorAt(memory, proc, 0), THISTLE_FD_HOST, THISTLE_FD_READ, 0);
  installDescriptor(memory, descriptorAt(memory, proc, 1), THISTLE_FD_HOST, THISTLE_FD_WRITE, 0);
  installDescriptor(memory, descriptorAt(memory, proc, 2), THISTLE_FD_HOST, THISTLE_FD_WRITE, 0);
  atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  bindProcess(memory, hart, slot);
  storeU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_COUNT, loadU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_COUNT) + 1);
  if (pid >= loadU32(memory, THISTLE_CONTROL_BASE + C_NEXT_PID)) storeU32(memory, THISTLE_CONTROL_BASE + C_NEXT_PID, pid + 1);
  release(memory, lock);
  return 0;
};

export const thistleProcessCount = (memory: ThistleMemory): U32 =>
  thistleKernelValid(memory) ? loadU32(memory, THISTLE_CONTROL_BASE + C_PROCESS_COUNT) : 0;

export const thistleResolvePath = (
  memory: ThistleMemory,
  hart: U32,
  start: U32,
  path: Ptr,
  pathLength: U32,
  followFinal: boolean,
): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart)) return -22;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  const lock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, lock)) return -11;
  const result = thistleVfsResolve(memory, proc, start, path, pathLength, followFinal);
  release(memory, lock);
  return result;
};

export const thistleAccessInode = (memory: ThistleMemory, hart: U32, inode: U32, bits: U32): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart)) return -22;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  const lock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, lock)) return -11;
  const result = thistleVfsAccess(memory, proc, inode, bits) ? 1 : 0;
  release(memory, lock);
  return result;
};

export const thistleOpenPath = (
  memory: ThistleMemory,
  hart: U32,
  start: U32,
  path: Ptr,
  pathLength: U32,
  flags: U32,
): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart) || (flags & 3) !== 0) return -30;
  if ((flags & ~(OPEN_DIRECTORY | OPEN_CLOEXEC)) !== 0) return -22;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return -3;
  if (!acquire(memory, proc + P_LOCK)) return -11;
  const vfsLock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, vfsLock)) {
    release(memory, proc + P_LOCK);
    return -11;
  }
  const result = openPathLocked(memory, proc, start, path, pathLength, flags);
  release(memory, vfsLock);
  release(memory, proc + P_LOCK);
  return result;
};

const openPathLocked = (
  memory: ThistleMemory, proc: Ptr, start: U32, path: Ptr, pathLength: U32, flags: U32,
): I32 => {
  if ((flags & 3) !== 0) return -30;
  if ((flags & ~(OPEN_DIRECTORY | OPEN_CLOEXEC | 0x8000)) !== 0) return -22;
  const base = start === 0 ? loadU32(memory, proc + P_CWD_INODE) : start;
  const resolved = thistleVfsResolve(memory, proc, base, path, pathLength, true);
  if (resolved < 0) {
    return resolved;
  }
  const inode = wordToU32(word(resolved));
  const kind = thistleVfsKind(memory, inode);
  if ((flags & OPEN_DIRECTORY) !== 0 && kind !== THISTLE_VFS_KIND_DIRECTORY) {
    return -20;
  }
  return thistleVfsOpenInode(memory, proc, inode, THISTLE_FD_READ | ((flags & OPEN_CLOEXEC) !== 0 ? THISTLE_FD_CLOEXEC : 0), 3);
};

export const thistleReadDescriptor = (
  memory: ThistleMemory,
  hart: U32,
  descriptor: U32,
  output: Ptr,
  length: U32,
): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart) || length > 1048576) return -22;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return -9;
  if (!acquire(memory, proc + P_LOCK)) return -11;
  const vfsLock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, vfsLock)) {
    release(memory, proc + P_LOCK);
    return -11;
  }
  const amount = thistleVfsReadDescriptor(memory, descriptorAt(memory, proc, descriptor), output, length);
  release(memory, vfsLock);
  release(memory, proc + P_LOCK);
  return amount;
};

/** SEEK_END reads size under the descriptor/VFS lock order; overflow must leave the cursor unchanged. */
export const thistleSeekDescriptor = (
  memory: ThistleMemory,
  hart: U32,
  descriptor: U32,
  offset: I64,
  whence: U32,
): I64 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart) || whence > 2) return -22n;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return -9n;
  if (!acquire(memory, proc + P_LOCK)) return -11n;
  const vfsLock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, vfsLock)) {
    release(memory, proc + P_LOCK);
    return -11n;
  }
  const next = thistleVfsSeekDescriptor(memory, descriptorAt(memory, proc, descriptor), offset, whence);
  release(memory, vfsLock);
  release(memory, proc + P_LOCK);
  return next;
};

export const thistleCloseDescriptor = (memory: ThistleMemory, hart: U32, descriptor: U32): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart)) return -22;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return -9;
  if (!acquire(memory, proc + P_LOCK)) return -11;
  const state = descriptorAt(memory, proc, descriptor);
  if (loadU32(memory, state + FD_KIND) === THISTLE_FD_EMPTY) {
    release(memory, proc + P_LOCK);
    return -9;
  }
  const lock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, lock)) {
    release(memory, proc + P_LOCK);
    return -11;
  }
  releaseDescriptor(memory, state);
  release(memory, lock);
  release(memory, proc + P_LOCK);
  return 0;
};

export const thistleDescriptorKind = (memory: ThistleMemory, hart: U32, descriptor: U32): U32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return 0;
  return loadU32(memory, descriptorAt(memory, proc, descriptor) + FD_KIND);
};

export const thistleDescriptorInode = (memory: ThistleMemory, hart: U32, descriptor: U32): U32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return 0;
  return loadU32(memory, descriptorAt(memory, proc, descriptor) + FD_INODE);
};

export const thistleDescriptorOffset = (memory: ThistleMemory, hart: U32, descriptor: U32): U64 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER || descriptor >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return 0n;
  return loadU64(memory, descriptorAt(memory, proc, descriptor) + FD_OFFSET);
};

export const thistleImageReserve = (memory: ThistleMemory, size: U32): Ptr => {
  if (!thistleKernelValid(memory) || size === 0 || size > 0x7ffffff0) return INVALID_POINTER;
  const imageLock = THISTLE_CONTROL_BASE + C_IMAGE_LOCK;
  if (!acquire(memory, imageLock)) return INVALID_POINTER;
  const memoryLock = THISTLE_CONTROL_BASE + C_MEMORY_LOCK;
  if (!acquire(memory, memoryLock)) {
    release(memory, imageLock);
    return INVALID_POINTER;
  }
  const aligned = (size + 15) & -16;
  const end = loadU32(memory, THISTLE_CONTROL_BASE + C_PHYSICAL_END);
  const next = loadU32(memory, THISTLE_CONTROL_BASE + C_PHYSICAL_NEXT);
  if (aligned < size || aligned > end || end - aligned < next) {
    release(memory, memoryLock);
    release(memory, imageLock);
    return INVALID_POINTER;
  }
  const at = end - aligned;
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_TOP, at);
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_SIZE, aligned);
  release(memory, memoryLock);
  return at;
};

export const thistleImageContains = (memory: ThistleMemory, at: Ptr, size: U32): boolean => inputContains(memory, at, size);

export const thistleImageRelease = (memory: ThistleMemory, at: Ptr, size: U32): I32 => {
  if (!thistleKernelValid(memory) || size === 0 || size > 0x7ffffff0) return THISTLE_THX_RANGE;
  const aligned = (size + 15) & -16;
  const imageLock = THISTLE_CONTROL_BASE + C_IMAGE_LOCK;
  if (atomicLoadI32(memory, imageLock) !== 1 ||
      at !== loadU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_TOP) ||
      aligned !== loadU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_SIZE)) return THISTLE_THX_RANGE;
  const memoryLock = THISTLE_CONTROL_BASE + C_MEMORY_LOCK;
  if (!acquire(memory, memoryLock)) return THISTLE_THX_BUSY;
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_TOP, loadU32(memory, THISTLE_CONTROL_BASE + C_PHYSICAL_END));
  storeU32(memory, THISTLE_CONTROL_BASE + C_IMAGE_SIZE, 0);
  release(memory, memoryLock);
  release(memory, imageLock);
  return THISTLE_THX_OK;
};

export const thistleHartVirtualTop = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_VIRTUAL_TOP) : 0n;

export const thistleHartImageFloor = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_IMAGE_FLOOR) : 0n;

export const thistleHartStackBottom = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_STACK_BOTTOM) : 0n;

export const thistleHartStackPointer = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_STACK_POINTER) : 0n;

export const thistleHartBreak = (memory: ThistleMemory, hart: U32): U64 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  return proc === INVALID_POINTER ? 0n : atomicLoadU64(memory, proc + P_BRK);
};

export const thistleProcessSegmentCount = (memory: ThistleMemory, hart: U32): U32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  return proc === INVALID_POINTER ? 0 : loadU32(memory, proc + P_SEGMENT_COUNT);
};

export const thistleProcessMapCount = (memory: ThistleMemory, hart: U32): U32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  return proc === INVALID_POINTER ? 0 : loadU32(memory, proc + P_MAP_COUNT);
};

export const thistleProcessMapAddress = (
  memory: ThistleMemory,
  hart: U32,
  index: U32,
): U64 => {
  const proc = validHart(memory, hart)
    ? processForHart(memory, hart)
    : INVALID_POINTER;

  if (
    proc === INVALID_POINTER ||
    index >= loadU32(memory, proc + P_MAP_COUNT)
  ) return 0n;

  return loadU64(memory, mapAt(memory, proc, index) + M_ADDRESS);
};

export const thistleProcessMapEnd = (
  memory: ThistleMemory,
  hart: U32,
  index: U32,
): U64 => {
  const proc = validHart(memory, hart)
    ? processForHart(memory, hart)
    : INVALID_POINTER;

  if (
    proc === INVALID_POINTER ||
    index >= loadU32(memory, proc + P_MAP_COUNT)
  ) return 0n;

  return loadU64(memory, mapAt(memory, proc, index) + M_END);
};

export const thistleProcessMapProtection = (
  memory: ThistleMemory,
  hart: U32,
  index: U32,
): U32 => {
  const proc = validHart(memory, hart)
    ? processForHart(memory, hart)
    : INVALID_POINTER;

  if (
    proc === INVALID_POINTER ||
    index >= loadU32(memory, proc + P_MAP_COUNT)
  ) return 0;

  return loadU32(memory, mapAt(memory, proc, index) + M_PROTECTION);
};

export const thistleHartGetX = (memory: ThistleMemory, hart: U32, register: U32): I64 => {
  if (!validHart(memory, hart) || register > 31) return 0n;
  return register === 0 ? 0n : loadI64(memory, regAt(hart, register));
};

export const thistleHartSetX = (memory: ThistleMemory, hart: U32, register: U32, value: I64): I32 => {
  if (!validHart(memory, hart) || register > 31) return THISTLE_FAULT_BAD_STATE;
  if (register !== 0) storeI64(memory, regAt(hart, register), sx(value, 64));
  return 0;
};

export const thistleHartGetF = (memory: ThistleMemory, hart: U32, register: U32): U64 => {
  if (!validHart(memory, hart) || register > 31) return 0n;
  return loadU64(memory, floatRegAt(hart, register));
};

export const thistleHartSetF = (memory: ThistleMemory, hart: U32, register: U32, value: U64): I32 => {
  if (!validHart(memory, hart) || register > 31) return THISTLE_FAULT_BAD_STATE;
  storeU64(memory, floatRegAt(hart, register), value);
  return 0;
};

export const thistleHartPc = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_PC) : 0n;

export const thistleHartSetPc = (memory: ThistleMemory, hart: U32, pc: U64): I32 => {
  if (!validHart(memory, hart) || pc >= loadU64(memory, hartAt(hart) + H_VIRTUAL_TOP)) return THISTLE_FAULT_BAD_STATE;
  storeU64(memory, hartAt(hart) + H_PC, pc);
  return 0;
};

export const thistleHartStatus = (memory: ThistleMemory, hart: U32): I32 =>
  validHart(memory, hart) ? atomicLoadI32(memory, hartAt(hart) + H_STATUS) : THISTLE_HART_EMPTY;

export const thistleHartMetric = (memory: ThistleMemory, hart: U32, offset: U32): U64 => {
  if (!validHart(memory, hart) || offset + 8 > THISTLE_HART_STRIDE || (offset & 7) !== 0) return 0n;
  return loadU64(memory, hartAt(hart) + offset);
};

export const thistleHostOperation = (memory: ThistleMemory, hart: U32): I32 =>
  validHart(memory, hart) ? loadI32(memory, hartAt(hart) + H_HOST_OPERATION) : THISTLE_HOST_NONE;

export const thistleHostDescriptor = (memory: ThistleMemory, hart: U32): I32 =>
  validHart(memory, hart) ? loadI32(memory, hartAt(hart) + H_HOST_DESCRIPTOR) : -1;

export const thistleHostAddress = (memory: ThistleMemory, hart: U32): U64 =>
  validHart(memory, hart) ? loadU64(memory, hartAt(hart) + H_HOST_ADDRESS) : 0n;

export const thistleHostLength = (memory: ThistleMemory, hart: U32): U32 =>
  validHart(memory, hart) ? loadU32(memory, hartAt(hart) + H_HOST_LENGTH) : 0;

export const thistleHartExitCode = (memory: ThistleMemory, hart: U32): I32 =>
  validHart(memory, hart) ? loadI32(memory, hartAt(hart) + H_EXIT_CODE) : -1;

const setX = (memory: ThistleMemory, hart: U32, register: U32, value: I64): void => {
  if (register !== 0) storeI64(memory, regAt(hart, register), sx(value, 64));
};

const x = (memory: ThistleMemory, hart: U32, register: U32): I64 =>
  register === 0 ? 0n : loadI64(memory, regAt(hart, register));

const f = (memory: ThistleMemory, hart: U32, register: U32): U64 =>
  loadU64(memory, floatRegAt(hart, register));

const setF = (memory: ThistleMemory, hart: U32, register: U32, value: U64): void =>
  storeU64(memory, floatRegAt(hart, register), value);

const setPc = (memory: ThistleMemory, hart: U32, value: U64): void =>
  storeU64(memory, hartAt(hart) + H_PC, ux(value));

const guestRange = (
  memory: ThistleMemory,
  hart: U32,
  address: U64,
  size: U32,
): boolean => {
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return false;
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  return address < top && ux(word(size)) <= top - address;
};

const guestAllowed = (
  memory: ThistleMemory,
  hart: U32,
  address: U64,
  size: U32,
  permission: U32,
): boolean => {
  if (!guestRange(memory, hart, address, size)) return false;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return false;
  const end = address + ux(word(size));
  const count = loadU32(memory, proc + P_SEGMENT_COUNT);
  const table = loadU32(memory, proc + P_SEGMENT_TABLE);
  let index: U32 = 0;
  while (index < count) {
    const segment = table + index * THISTLE_SEGMENT_STRIDE;
    if (address >= loadU64(memory, segment + S_ADDRESS) && end <= loadU64(memory, segment + S_END)) {
      return (loadU32(memory, segment + S_FLAGS) & permission) === permission;
    }
    index += 1;
  }
  // Loaded segments retain their own access flags. The ordinary heap and
  // stack are non-executable, but anonymous mmap regions may be executable
  // when explicitly created or protected with PROT_EXEC.
  const executable = (permission & THISTLE_SEGMENT_EXECUTE) !== 0;
  const stack = atomicLoadU64(memory, proc + P_STACK_BOTTOM);
  if (stack !== 0n && address >= stack && end <= atomicLoadU64(memory, proc + P_VIRTUAL_TOP)) return !executable;
  const heap = atomicLoadU64(memory, proc + P_BRK_BASE);
  if (heap !== 0n && address >= heap && end <= atomicLoadU64(memory, proc + P_BRK)) return !executable;
  const mapCount = loadU32(memory, proc + P_MAP_COUNT);
  const mapTable = loadU32(memory, proc + P_MAP_TABLE);
  index = 0;
  while (index < mapCount) {
    const mapping = mapTable + index * THISTLE_MAP_STRIDE;
    if (address >= loadU64(memory, mapping + M_ADDRESS) && end <= loadU64(memory, mapping + M_END)) {
      return (loadU32(memory, mapping + M_PROTECTION) & permission) === permission;
    }
    index += 1;
  }
  return false;
};

/** Host syscalls use the same mapped-range and permission checks as guest instructions. */
export const thistleGuestAccess = (memory: ThistleMemory, hart: U32, pid: U32, address: U64, size: U32, permission: U32): I32 => {
  if (!validKernel(memory) || !validHart(memory, hart) || permission < 1 || permission > 7) return -22;
  if (address < 0n || size < 0 || size > 0xffffffff || floatFloor(size) !== size) return -14;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return -11;
  const proc = processForHart(memory, hart);
  let result: I32 = -3;
  if (proc !== INVALID_POINTER && loadU32(memory, proc + P_PID) === pid) {
    const allowed = size === 0 ? address <= atomicLoadU64(memory, proc + P_VIRTUAL_TOP)
      : guestAllowed(memory, hart, address, size, permission);
    result = allowed ? 0 : -14;
  }
  release(memory, at + H_LOCK);
  return result;
};

const pageHash = (page: U64, capacity: U32): U32 =>
  wordToU32((page ^ page >> 32n) * 0x9e3779b1n) & (capacity - 1);

// Caller holds the hart lock. Under the memory lock, recheck the hash slot
// before committing a backing frame; another hart may have inserted a page.
const insertGuestPage = (memory: ThistleMemory, hart: U32, proc: Ptr, entry: Ptr, key: U64): Ptr => {
  const lockAt = THISTLE_CONTROL_BASE + C_MEMORY_LOCK;
  if (!acquire(memory, lockAt)) return INVALID_POINTER;
  const recheck = atomicLoadU64(memory, entry);
  if (recheck === key) {
    const existing = loadU32(memory, entry + 8);
    release(memory, lockAt);
    return existing;
  }
  if (recheck !== 0n) { release(memory, lockAt); return UNMAPPED_POINTER; }
  const frame = allocateFrame(memory);
  if (frame === INVALID_POINTER) { release(memory, lockAt); return INVALID_POINTER; }
  storeU32(memory, entry + 8, frame);
  storeU32(memory, entry + 12, 0);
  const pageCount = wordToU32(word(atomicLoadI32(memory, proc + P_PAGE_COUNT))) + 1;
  atomicStoreI32(memory, proc + P_PAGE_COUNT, wordToI32(word(pageCount)));
  storeU32(memory, hartAt(hart) + H_PAGE_COUNT, pageCount);
  atomicStoreU64(memory, entry, key);
  release(memory, lockAt);
  return frame;
};

const guestPage = (memory: ThistleMemory, hart: U32, address: U64, create: boolean): Ptr => {
  if (!guestRange(memory, hart, address, 1)) return INVALID_POINTER;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return INVALID_POINTER;
  const table = wordToU32(word(atomicLoadI32(memory, proc + P_PAGE_TABLE)));
  const capacity = wordToU32(word(atomicLoadI32(memory, proc + P_PAGE_CAPACITY)));
  const page = address >> 16n;
  const key = page + 1n;
  let slot = pageHash(page, capacity);
  let probe: U32 = 0;
  while (probe < capacity) {
    const entry = table + slot * THISTLE_PAGE_ENTRY_SIZE;
    const found = atomicLoadU64(memory, entry);
    if (found === key) return loadU32(memory, entry + 8);
    if (found === 0n && !create) return UNMAPPED_POINTER;
    const inserted = found === 0n ? insertGuestPage(memory, hart, proc, entry, key) : UNMAPPED_POINTER;
    if (inserted !== UNMAPPED_POINTER) return inserted;
    slot = (slot + 1) & (capacity - 1);
    probe += 1;
  }
  return INVALID_POINTER;
};

const clearMappedRange = (memory: ThistleMemory, proc: Ptr, start: U64, end: U64): void => {
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const capacity = loadU32(memory, proc + P_PAGE_CAPACITY);
  let slot: U32 = 0;
  while (slot < capacity) {
    const entry = table + slot * THISTLE_PAGE_ENTRY_SIZE;
    const key = atomicLoadU64(memory, entry);
    if (key === 0n) { slot += 1; continue; }
    const page = (key - 1n) << 16n;
    const pageEnd = page + ux(word(THISTLE_GUEST_PAGE_SIZE));
    if (start < pageEnd && end > page) {
      const low = start > page ? start : page;
      const high = end < pageEnd ? end : pageEnd;
      fill(memory, loadU32(memory, entry + 8) + wordToU32(low - page), wordToU32(high - low), 0);
    }
    slot += 1;
  }
};

const mapAt = (memory: ThistleMemory, proc: Ptr, index: U32): Ptr =>
  loadU32(memory, proc + P_MAP_TABLE) + index * THISTLE_MAP_STRIDE;

const copyMap = (memory: ThistleMemory, to: Ptr, from: Ptr): void => {
  storeU64(memory, to + M_ADDRESS, loadU64(memory, from + M_ADDRESS));
  storeU64(memory, to + M_END, loadU64(memory, from + M_END));
  storeU32(memory, to + M_PROTECTION, loadU32(memory, from + M_PROTECTION));
  storeU32(memory, to + M_FLAGS, loadU32(memory, from + M_FLAGS));
  storeI32(memory, to + M_FILE_DESCRIPTOR, loadI32(memory, from + M_FILE_DESCRIPTOR));
  storeU64(memory, to + M_FILE_OFFSET, loadU64(memory, from + M_FILE_OFFSET));
  storeU32(memory, to + M_BACKING, loadU32(memory, from + M_BACKING));
  storeU32(memory, to + M_BACKING + 4, 0);
};

const mappingConflict = (memory: ThistleMemory, proc: Ptr, address: U64, end: U64): boolean => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  const stack = atomicLoadU64(memory, proc + P_STACK_BOTTOM);
  const heap = atomicLoadU64(memory, proc + P_BRK);
  if (address < (heap + MAP_GUARD + MAP_PAGE - 1n & -MAP_PAGE) || end <= address || end > top ||
      stack <= MAP_GUARD || end >= stack - MAP_GUARD) return true;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    if (address < loadU64(memory, mapping + M_END) && end > loadU64(memory, mapping + M_ADDRESS)) return true;
    index += 1;
  }
  return false;
};

// MAP_FIXED can split or replace reservations, but capacity must be validated
// before the old mappings are removed. MAP_FIXED_NOREPLACE never calls this.
const replaceFixedMapping = (memory: ThistleMemory, proc: Ptr, candidate: U64, size: U64): I64 => {
  const end = candidate + size;
  const heap = atomicLoadU64(memory, proc + P_BRK);
  const stack = atomicLoadU64(memory, proc + P_STACK_BOTTOM);
  if (candidate < (heap + MAP_GUARD + MAP_PAGE - 1n & -MAP_PAGE) || stack <= MAP_GUARD || end >= stack - MAP_GUARD) return -12n;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  const capacity = loadU32(memory, proc + P_MAP_CAPACITY);
  let finalCount = count + 1;
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    const start = loadU64(memory, mapping + M_ADDRESS);
    const stop = loadU64(memory, mapping + M_END);
    const overlaps = candidate < stop && end > start;
    if (overlaps && candidate <= start && end >= stop) finalCount -= 1;
    if (overlaps && candidate > start && end < stop) finalCount += 1;
    index += 1;
  }
  if (finalCount > capacity) return -12n;
  const removed = anonymousUnmap(memory, proc, candidate, size);
  return removed === MAP_NOT_OWNED ? 0n : removed;
};

const findMappingAddress = (memory: ThistleMemory, proc: Ptr, hint: U64, size: U64, top: U64): I64 => {
  let candidate = hint === 0n || hint > top - MAP_PAGE + 1n ? 0n : hint + MAP_PAGE - 1n & -MAP_PAGE;
  if (candidate !== 0n && candidate <= top && size <= top - candidate && !mappingConflict(memory, proc, candidate, candidate + size)) return sx(candidate, 64);
  const minimum = atomicLoadU64(memory, proc + P_BRK) + MAP_SPACING + MAP_PAGE - 1n & -MAP_PAGE;
  candidate = atomicLoadU64(memory, proc + P_MAP_NEXT);
  if (candidate < minimum || candidate > top || size > top - candidate) candidate = minimum;
  let attempts: U32 = 0;
  const capacity = loadU32(memory, proc + P_MAP_CAPACITY);
  while (attempts <= capacity && (candidate > top || size > top - candidate || mappingConflict(memory, proc, candidate, candidate + size))) {
    if (candidate > top - MAP_SPACING) return -12n;
    candidate = candidate + MAP_SPACING + MAP_PAGE - 1n & -MAP_PAGE;
    attempts += 1;
  }
  if (candidate > top || size > top - candidate || mappingConflict(memory, proc, candidate, candidate + size)) return -12n;
  return sx(candidate, 64);
};

const anonymousMap = (memory: ThistleMemory, proc: Ptr, address: U64, length: U64, protection: U64, flagsWide: U64): I64 => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if (length === 0n || length > top || protection > 7n || flagsWide > 0x7fffffffn) return -22n;
  const flags = wordToU32(flagsWide);
  const kind = flags & 3;
  // Linux MAP_NORESERVE (0x4000) is advisory for anonymous mappings.
  // V8 uses it for PROT_NONE virtual reservations, including Oilpan GCInfoTable.
  // Thistle allocates backing frames lazily, so accepting this flag preserves
  // reservation semantics without committing the whole virtual range.
  if ((flags & 0x20) === 0 || (kind !== 1 && kind !== 2) || (flags & ~0x104033) !== 0) return -22n;
  const size = length + MAP_PAGE - 1n & -MAP_PAGE;
  if (size === 0n || size > top) return -12n;
  const fixed = (flags & 0x100010) !== 0;
  const replace = (flags & 0x10) !== 0 && (flags & 0x100000) === 0;
  let candidate = address;
  if (fixed && ((candidate & (MAP_PAGE - 1n)) !== 0n || candidate > top || size > top - candidate)) return -12n;
  const replaced = fixed && replace ? replaceFixedMapping(memory, proc, candidate, size) : 0n;
  if (replaced !== 0n) return replaced;
  if (fixed && !replace && mappingConflict(memory, proc, candidate, candidate + size)) return (flags & 0x100000) !== 0 ? -17n : -12n;
  if (!fixed) candidate = ux(findMappingAddress(memory, proc, candidate, size, top));
  if (candidate > top || size > top - candidate) return -12n;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  if (count >= loadU32(memory, proc + P_MAP_CAPACITY)) return -12n;
  clearMappedRange(memory, proc, candidate, candidate + size);
  const mapping = mapAt(memory, proc, count);
  fill(memory, mapping, THISTLE_MAP_STRIDE, 0);
  storeU64(memory, mapping + M_ADDRESS, candidate);
  storeU64(memory, mapping + M_END, candidate + size);
  storeU32(memory, mapping + M_PROTECTION, wordToU32(protection));
  storeU32(memory, mapping + M_FLAGS, flags);
  storeI32(memory, mapping + M_FILE_DESCRIPTOR, -1);
  storeU32(memory, mapping + M_BACKING, THISTLE_MAP_BACKING_ANONYMOUS);
  atomicStoreI32(memory, proc + P_MAP_COUNT, wordToI32(word(count + 1)));
  const next = candidate + size + MAP_PAGE - 1n & -MAP_PAGE;
  if (next > atomicLoadU64(memory, proc + P_MAP_NEXT)) atomicStoreU64(memory, proc + P_MAP_NEXT, next);
  return sx(candidate, 64);
};

// Hart locking keeps the canonical binding live while host mapping operations hold P_LOCK.
const lockHostMapping = (memory: ThistleMemory, hart: U32): I64 => {
  if (!validKernel(memory) || !validHart(memory, hart)) return -22n;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return -11n;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) { release(memory, at + H_LOCK); return -3n; }
  if (!acquire(memory, proc + P_LOCK)) { release(memory, at + H_LOCK); return -11n; }
  return word(proc);
};

const unlockHostMapping = (memory: ThistleMemory, hart: U32, proc: Ptr): void => {
  release(memory, proc + P_LOCK);
  release(memory, hartAt(hart) + H_LOCK);
};

/** Reserve a hosted file mapping in the canonical address-space tables. */
export const thistleMapHostFile = (
  memory: ThistleMemory, hart: U32, address: U64, length: U64, protection: U64, flags: U64,
): I64 => {
  const locked = lockHostMapping(memory, hart);
  if (locked < 0n) return locked;
  const proc = wordToPtr(locked);
  const result = anonymousMap(memory, proc, address, length, protection, flags | 0x20n);
  if (result >= 0n) {
    const count = loadU32(memory, proc + P_MAP_COUNT);
    storeU32(memory, mapAt(memory, proc, count - 1) + M_BACKING, THISTLE_MAP_BACKING_HOST_FILE);
  }
  unlockHostMapping(memory, hart, proc);
  return result;
};

/** Release a hosted mapping after its shared file data has been flushed. */
export const thistleUnmapHostFile = (memory: ThistleMemory, hart: U32, address: U64, length: U64): I64 => {
  const locked = lockHostMapping(memory, hart);
  if (locked < 0n) return locked;
  const proc = wordToPtr(locked);
  const result = anonymousUnmap(memory, proc, address, length);
  unlockHostMapping(memory, hart, proc);
  return result;
};

/** Resize the hosted mapping described by this hart's mremap syscall registers. */
export const thistleRemapHostFile = (memory: ThistleMemory, hart: U32): I64 => {
  const locked = lockHostMapping(memory, hart);
  if (locked < 0n) return locked;
  const proc = wordToPtr(locked);
  const result = remapMapping(memory, hart, proc, THISTLE_MAP_BACKING_HOST_FILE);
  unlockHostMapping(memory, hart, proc);
  return result === MAP_NOT_OWNED ? -22n : result;
};

const overlapsHostFile = (memory: ThistleMemory, proc: Ptr, address: U64, length: U64): boolean => {
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    if (loadU32(memory, mapping + M_BACKING) === THISTLE_MAP_BACKING_HOST_FILE && address < loadU64(memory, mapping + M_END) &&
        address + length > loadU64(memory, mapping + M_ADDRESS)) return true;
    index += 1;
  }
  return false;
};

const unmapSplitCount = (memory: ThistleMemory, proc: Ptr, address: U64, end: U64): I32 => {
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  let splits: I32 = 0;
  let hit = false;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    const start = loadU64(memory, mapping + M_ADDRESS), stop = loadU64(memory, mapping + M_END);
    const overlaps = address < stop && end > start;
    if (overlaps) hit = true;
    if (overlaps && address > start && end < stop) splits += 1;
    index += 1;
  }
  return hit ? splits : -1;
};

const eraseMapEntry = (memory: ThistleMemory, proc: Ptr, index: U32, count: U32): U32 => {
  let move = index;
  while (move + 1 < count) {
    copyMap(memory, mapAt(memory, proc, move), mapAt(memory, proc, move + 1));
    move += 1;
  }
  fill(memory, mapAt(memory, proc, count - 1), THISTLE_MAP_STRIDE, 0);
  return count - 1;
};

const applyUnmap = (memory: ThistleMemory, proc: Ptr, address: U64, end: U64): void => {
  let count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    const start = loadU64(memory, mapping + M_ADDRESS);
    const stop = loadU64(memory, mapping + M_END);
    if (address >= stop || end <= start) {
      index += 1;
      continue;
    }
    const low = address > start ? address : start;
    const high = end < stop ? end : stop;
    clearMappedRange(memory, proc, low, high);
    if (address <= start && end >= stop) {
      count = eraseMapEntry(memory, proc, index, count);
      continue;
    }
    if (address <= start) {
      storeU64(memory, mapping + M_ADDRESS, end);
      storeU64(memory, mapping + M_FILE_OFFSET, loadU64(memory, mapping + M_FILE_OFFSET) + end - start);
      index += 1;
      continue;
    }
    if (end >= stop) {
      storeU64(memory, mapping + M_END, address);
      index += 1;
      continue;
    }
    const right = mapAt(memory, proc, count);
    copyMap(memory, right, mapping);
    storeU64(memory, mapping + M_END, address);
    storeU64(memory, right + M_ADDRESS, end);
    storeU64(memory, right + M_FILE_OFFSET, loadU64(memory, mapping + M_FILE_OFFSET) + end - start);
    count += 1;
    index += 1;
  }
  atomicStoreI32(memory, proc + P_MAP_COUNT, wordToI32(word(count)));
};

const anonymousUnmap = (memory: ThistleMemory, proc: Ptr, address: U64, length: U64): I64 => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if (length === 0n || (address & (MAP_PAGE - 1n)) !== 0n || address >= top || length > top - address) return -22n;
  const size = length + MAP_PAGE - 1n & -MAP_PAGE;
  if (size === 0n || size > top - address) return -22n;
  const end = address + size;
  const splits = unmapSplitCount(memory, proc, address, end);
  if (splits < 0) return MAP_NOT_OWNED;
  if (wordToU32(word(splits)) > loadU32(memory, proc + P_MAP_CAPACITY) - loadU32(memory, proc + P_MAP_COUNT)) return -12n;
  applyUnmap(memory, proc, address, end);
  return 0n;
};

const mappingsCover = (memory: ThistleMemory, proc: Ptr, address: U64, end: U64): boolean => {
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let cursor = address;
  while (cursor < end) {
    let found = false;
    let index: U32 = 0;
    while (index < count) {
      const mapping = mapAt(memory, proc, index);
      const start = loadU64(memory, mapping + M_ADDRESS);
      const stop = loadU64(memory, mapping + M_END);
      if (cursor >= start && cursor < stop) {
        cursor = stop < end ? stop : end;
        found = true;
        break;
      }
      index += 1;
    }
    if (!found) return false;
  }
  return true;
};

const protectMappings = (memory: ThistleMemory, proc: Ptr, address: U64, length: U64, protection: U64): I64 => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if (length === 0n || protection > 7n || (address & (MAP_PAGE - 1n)) !== 0n ||
      address >= top || length > top - address) return -22n;
  const size = length + MAP_PAGE - 1n & -MAP_PAGE;
  if (size === 0n || size > top - address) return -22n;
  const end = address + size;
  const original = loadU32(memory, proc + P_MAP_COUNT);
  let hit = false;
  let needed: U32 = 0;
  let index: U32 = 0;
  while (index < original) {
    const mapping = mapAt(memory, proc, index);
    const start = loadU64(memory, mapping + M_ADDRESS);
    const stop = loadU64(memory, mapping + M_END);
    const overlaps = address < stop && end > start;
    if (overlaps) hit = true;
    if (overlaps && address > start) needed += 1;
    if (overlaps && end < stop) needed += 1;
    index += 1;
  }
  if (!hit) return MAP_NOT_OWNED;
  if (!mappingsCover(memory, proc, address, end)) return -12n;
  const capacity = loadU32(memory, proc + P_MAP_CAPACITY);
  if (needed > capacity - original) return -12n;
  let count = original;
  index = 0;
  while (index < original) {
    const mapping = mapAt(memory, proc, index);
    const start = loadU64(memory, mapping + M_ADDRESS);
    const stop = loadU64(memory, mapping + M_END);
    if (address >= stop || end <= start) {
      index += 1;
      continue;
    }
    const low = address > start ? address : start;
    const high = end < stop ? end : stop;
    const oldOffset = loadU64(memory, mapping + M_FILE_OFFSET);
    if (low === start && high === stop) {
      storeU32(memory, mapping + M_PROTECTION, wordToU32(protection));
      index += 1;
      continue;
    }
    if (low === start) {
      const right = mapAt(memory, proc, count);
      copyMap(memory, right, mapping);
      storeU64(memory, right + M_ADDRESS, high);
      storeU64(memory, right + M_FILE_OFFSET, oldOffset + high - start);
      storeU64(memory, mapping + M_END, high);
      storeU32(memory, mapping + M_PROTECTION, wordToU32(protection));
      count += 1;
      index += 1;
      continue;
    }
    if (high === stop) {
      const changed = mapAt(memory, proc, count);
      copyMap(memory, changed, mapping);
      storeU64(memory, changed + M_ADDRESS, low);
      storeU64(memory, changed + M_FILE_OFFSET, oldOffset + low - start);
      storeU32(memory, changed + M_PROTECTION, wordToU32(protection));
      storeU64(memory, mapping + M_END, low);
      count += 1;
      index += 1;
      continue;
    }
    {
      const changed = mapAt(memory, proc, count);
      const right = mapAt(memory, proc, count + 1);
      copyMap(memory, changed, mapping);
      copyMap(memory, right, mapping);
      storeU64(memory, mapping + M_END, low);
      storeU64(memory, changed + M_ADDRESS, low);
      storeU64(memory, changed + M_END, high);
      storeU64(memory, changed + M_FILE_OFFSET, oldOffset + low - start);
      storeU32(memory, changed + M_PROTECTION, wordToU32(protection));
      storeU64(memory, right + M_ADDRESS, high);
      storeU64(memory, right + M_FILE_OFFSET, oldOffset + high - start);
      count += 2;
    }
    index += 1;
  }
  atomicStoreI32(memory, proc + P_MAP_COUNT, wordToI32(word(count)));
  return 0n;
};

const mappingConflictExcept = (memory: ThistleMemory, proc: Ptr, address: U64, end: U64, except: U32): boolean => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  const stack = atomicLoadU64(memory, proc + P_STACK_BOTTOM);
  const heap = atomicLoadU64(memory, proc + P_BRK);
  if (address < (heap + MAP_GUARD + MAP_PAGE - 1n & -MAP_PAGE) || end <= address || end > top ||
      stack <= MAP_GUARD || end >= stack - MAP_GUARD) return true;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    if (index !== except && address < loadU64(memory, mapping + M_END) && end > loadU64(memory, mapping + M_ADDRESS)) return true;
    index += 1;
  }
  return false;
};

const copyPageSpan = (memory: ThistleMemory, hart: U32, destination: U64, source: Ptr, amount: U32): boolean => {
  // A source span can cross a destination page boundary when offsets differ.
  let copied: U32 = 0;
  while (copied < amount) {
    const target = destination + ux(word(copied));
    const targetFrame = guestPage(memory, hart, target, true);
    if (targetFrame === INVALID_POINTER || targetFrame === UNMAPPED_POINTER) return false;
    const within = wordToU32(target & 0xffffn);
    const room = THISTLE_GUEST_PAGE_SIZE - within;
    const part = room < amount - copied ? room : amount - copied;
    copyMemory(memory, targetFrame + within, source + copied, part);
    copied += part;
  }
  return true;
};

const copyAllocatedRange = (memory: ThistleMemory, hart: U32, proc: Ptr, source: U64, destination: U64, length: U64): boolean => {
  // Only resident source pages need copying; unmapped parts of an anonymous range remain zero-filled.
  const table = loadU32(memory, proc + P_PAGE_TABLE);
  const capacity = loadU32(memory, proc + P_PAGE_CAPACITY);
  const sourceEnd = source + length;
  let slot: U32 = 0;
  while (slot < capacity) {
    const entry = table + slot * THISTLE_PAGE_ENTRY_SIZE;
    const key = atomicLoadU64(memory, entry);
    if (key === 0n) { slot += 1; continue; }
    const page = (key - 1n) << 16n;
    const pageEnd = page + ux(word(THISTLE_GUEST_PAGE_SIZE));
    if (source >= pageEnd || sourceEnd <= page) { slot += 1; continue; }
    const low = source > page ? source : page;
    const high = sourceEnd < pageEnd ? sourceEnd : pageEnd;
    const sourceFrame = loadU32(memory, entry + 8);
    if (!copyPageSpan(memory, hart, destination + low - source, sourceFrame + wordToU32(low - page), wordToU32(high - low))) return false;
    slot += 1;
  }
  return true;
};

const advanceMapCursor = (memory: ThistleMemory, proc: Ptr, next: U64): void => {
  if (next > atomicLoadU64(memory, proc + P_MAP_NEXT)) atomicStoreU64(memory, proc + P_MAP_NEXT, next);
};

// Publish a replacement only after its backing pages have been copied; allocation failure retains the source.
const moveMapping = (memory: ThistleMemory, hart: U32, proc: Ptr, mapping: Ptr, newSize: U64): I64 => {
  const oldAddress = loadU64(memory, mapping + M_ADDRESS);
  const oldSize = loadU64(memory, mapping + M_END) - oldAddress;
  const mapFlags = loadU32(memory, mapping + M_FLAGS) & ~0x100010;
  const moved = anonymousMap(memory, proc, 0n, newSize, ux(word(loadU32(memory, mapping + M_PROTECTION))), ux(word(mapFlags)));
  if (moved < 0n) return moved;
  const destination = ux(moved);
  if (!copyAllocatedRange(memory, hart, proc, oldAddress, destination, oldSize)) {
    anonymousUnmap(memory, proc, destination, newSize);
    return -12n;
  }
  const target = mapAt(memory, proc, loadU32(memory, proc + P_MAP_COUNT) - 1);
  storeU32(memory, target + M_BACKING, loadU32(memory, mapping + M_BACKING));
  storeI32(memory, target + M_FILE_DESCRIPTOR, loadI32(memory, mapping + M_FILE_DESCRIPTOR));
  storeU64(memory, target + M_FILE_OFFSET, loadU64(memory, mapping + M_FILE_OFFSET));
  const removed = anonymousUnmap(memory, proc, oldAddress, oldSize);
  if (removed !== 0n) return -12n;
  return sx(destination, 64);
};

const remapMapping = (memory: ThistleMemory, hart: U32, proc: Ptr, backing: U32): I64 => {
  const oldAddress = ux(x(memory, hart, 10));
  const oldLength = ux(x(memory, hart, 11));
  const newLength = ux(x(memory, hart, 12));
  const flagsWide = ux(x(memory, hart, 13));
  const fixedAddress = ux(x(memory, hart, 14));
  // Grow in place when possible; moving a mapping is allowed only after checking the requested flags.
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if ((oldAddress & (MAP_PAGE - 1n)) !== 0n || oldLength === 0n || newLength === 0n ||
      oldLength > top || newLength > top || flagsWide > 1n || fixedAddress !== 0n) return -22n;
  const oldSize = oldLength + MAP_PAGE - 1n & -MAP_PAGE;
  const newSize = newLength + MAP_PAGE - 1n & -MAP_PAGE;
  if (oldSize === 0n || newSize === 0n || oldAddress > top || oldSize > top - oldAddress) return -22n;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  let found = count;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    if (loadU64(memory, mapping + M_ADDRESS) === oldAddress && loadU64(memory, mapping + M_END) === oldAddress + oldSize &&
        loadU32(memory, mapping + M_BACKING) === backing) found = index;
    index += 1;
  }
  if (found === count) return MAP_NOT_OWNED;
  const mapping = mapAt(memory, proc, found);
  if (newSize === oldSize) return sx(oldAddress, 64);
  if (newSize < oldSize) {
    clearMappedRange(memory, proc, oldAddress + newSize, oldAddress + oldSize);
    storeU64(memory, mapping + M_END, oldAddress + newSize);
    return sx(oldAddress, 64);
  }
  const extended = oldAddress + newSize;
  if (!mappingConflictExcept(memory, proc, oldAddress, extended, found)) {
    clearMappedRange(memory, proc, oldAddress + oldSize, extended);
    storeU64(memory, mapping + M_END, extended);
    advanceMapCursor(memory, proc, extended);
    return sx(oldAddress, 64);
  }
  if ((wordToU32(flagsWide) & 1) === 0) return -12n;
  return moveMapping(memory, hart, proc, mapping, newSize);
};

const syncAnonymous = (memory: ThistleMemory, proc: Ptr, address: U64, length: U64, flagsWide: U64): I64 => {
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if (length === 0n || (address & (MAP_PAGE - 1n)) !== 0n || address >= top || length > top - address ||
      flagsWide > 7n || (wordToU32(flagsWide) & 5) === 0) return -22n;
  const size = length + MAP_PAGE - 1n & -MAP_PAGE;
  if (size === 0n || size > top - address) return -22n;
  const end = address + size;
  if (!mappingsCover(memory, proc, address, end)) return MAP_NOT_OWNED;
  const count = loadU32(memory, proc + P_MAP_COUNT);
  let index: U32 = 0;
  while (index < count) {
    const mapping = mapAt(memory, proc, index);
    if (address < loadU64(memory, mapping + M_END) && end > loadU64(memory, mapping + M_ADDRESS) &&
        loadU32(memory, mapping + M_BACKING) !== THISTLE_MAP_BACKING_ANONYMOUS) return MAP_NOT_OWNED;
    index += 1;
  }
  return 0n;
};

export const thistleGuestPage = (memory: ThistleMemory, hart: U32, address: U64, create: boolean): Ptr =>
  validHart(memory, hart) ? guestPage(memory, hart, address, create) : INVALID_POINTER;

const guestPointer = (memory: ThistleMemory, hart: U32, address: U64, size: U32, create: boolean): Ptr => {
  if (!guestRange(memory, hart, address, size)) return INVALID_POINTER;
  const offset = wordToU32(address & 0xffffn);
  if (size > THISTLE_GUEST_PAGE_SIZE - offset) return INVALID_POINTER;
  const page = guestPage(memory, hart, address, create);
  if (page === INVALID_POINTER || page === UNMAPPED_POINTER) return page;
  return page + offset;
};

const guestLoadU8 = (memory: ThistleMemory, hart: U32, address: U64): I32 => {
  if (!guestRange(memory, hart, address, 1)) return -1;
  const pointer = guestPointer(memory, hart, address, 1, false);
  if (pointer === INVALID_POINTER) return -1;
  return pointer === UNMAPPED_POINTER ? 0 : loadU8(memory, pointer);
};

const guestLoadU64 = (memory: ThistleMemory, hart: U32, address: U64, size: U32): U64 => {
  let value: U64 = 0n;
  let index: U32 = 0;
  while (index < size) {
    const byte = guestLoadU8(memory, hart, address + ux(word(index)));
    if (byte < 0) return 0n;
    value |= ux(word(byte)) << word(index * 8);
    index += 1;
  }
  return value;
};

const guestStoreU64 = (memory: ThistleMemory, hart: U32, address: U64, value: U64, size: U32): boolean => {
  if (!guestRange(memory, hart, address, size)) return false;
  traceNodePointerWrite(memory, hart, address, value, size);
  let index: U32 = 0;
  while (index < size) {
    const pointer = guestPointer(memory, hart, address + ux(word(index)), 1, true);
    if (pointer === INVALID_POINTER || pointer === UNMAPPED_POINTER) return false;
    storeU8(memory, pointer, sx(value >> word(index * 8), 64));
    index += 1;
  }
  return true;
};

const guestWritable = (memory: ThistleMemory, hart: U32, address: U64, size: U32): boolean => {
  if (!guestRange(memory, hart, address, size)) return false;
  let offset: U32 = 0;
  while (offset < size) {
    const current = address + ux(word(offset));
    const page = guestPage(memory, hart, current, true);
    if (page === INVALID_POINTER || page === UNMAPPED_POINTER) return false;
    const within = wordToU32(current & 0xffffn);
    const left = THISTLE_GUEST_PAGE_SIZE - within;
    offset += left < size - offset ? left : size - offset;
  }
  return true;
};

// Loading is an embedding-controlled operation: the process is quiescent.
// Host-file mappings must be flushed/unmapped before their page table is discarded.
const resetImagePages = (memory: ThistleMemory, proc: Ptr): I32 => {
  if (overlapsHostFile(memory, proc, 0n, atomicLoadU64(memory, proc + P_VIRTUAL_TOP))) return THISTLE_THX_BUSY;
  if (!acquire(memory, C_MEMORY_LOCK)) return THISTLE_THX_BUSY;
  if (!validProcessFrames(memory, proc)) {
    release(memory, C_MEMORY_LOCK);
    return THISTLE_THX_MEMORY;
  }
  releaseProcessFrames(memory, proc);
  trimFreeFrames(memory);
  release(memory, C_MEMORY_LOCK);
  return THISTLE_THX_OK;
};

//@cg-expect-error
export const thistleImageBegin = (
  memory: ThistleMemory,
  hart: U32,
  virtualTop: U64,
  entry: U64,
  phdr: U64,
  phent: U32,
  phnum: U32,
): I32 => {
  if (!validHart(memory, hart) || virtualTop < 1024n * 1024n ||
      virtualTop > 0x0000ffffffffffffn || entry < 0x10000n || entry >= virtualTop ||
      phdr >= virtualTop && phdr !== 0n) return THISTLE_THX_MEMORY;
  const proc = processForHart(memory, hart);
  if (proc === INVALID_POINTER) return THISTLE_THX_MEMORY;
  const reset = resetImagePages(memory, proc);
  if (reset !== THISTLE_THX_OK) return reset;
  const segmentTable = loadU32(memory, proc + P_SEGMENT_TABLE);
  const segmentCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_CAPACITY);
  const mapTable = loadU32(memory, proc + P_MAP_TABLE);
  const mapCapacity = loadU32(memory, proc + P_MAP_CAPACITY);
  fill(memory, segmentTable, segmentCapacity * THISTLE_SEGMENT_STRIDE, 0);
  fill(memory, mapTable, mapCapacity * THISTLE_MAP_STRIDE, 0);
  atomicStoreI32(memory, proc + P_PAGE_COUNT, 0);
  atomicStoreI32(memory, proc + P_SEGMENT_COUNT, 0);
  atomicStoreI32(memory, proc + P_MAP_COUNT, 0);
  atomicStoreU64(memory, proc + P_MAP_NEXT, 0x4000000000n);
  atomicStoreU64(memory, proc + P_VIRTUAL_TOP, virtualTop);
  atomicStoreU64(memory, proc + P_IMAGE_FLOOR, 0n);
  atomicStoreU64(memory, proc + P_IMAGE_ENTRY, entry);
  atomicStoreU64(memory, proc + P_BRK_BASE, 0n);
  atomicStoreU64(memory, proc + P_BRK, 0n);
  atomicStoreU64(memory, proc + P_PHDR, phdr);
  atomicStoreI32(memory, proc + P_PHENT, wordToI32(word(phent)));
  atomicStoreI32(memory, proc + P_PHNUM, wordToI32(word(phnum)));
  const state = hartAt(hart);
  storeU64(memory, state + H_VIRTUAL_TOP, virtualTop);
  storeU64(memory, state + H_PC, entry);
  storeU64(memory, state + H_IMAGE_FLOOR, 0n);
  storeU32(memory, state + H_PAGE_COUNT, 0);
  storeI64(memory, state + H_RESERVATION, NO_RESERVATION);
  return THISTLE_THX_OK;
};

// A segment must satisfy guest-range, overlap and source-image checks before its mapping is published.
//@cg-expect-error
export const thistleImageSegment = (
  memory: ThistleMemory,
  hart: U32,
  nameHash: U32,
  nameLength: U32,
  address: U64,
  size: U64,
  flags: U32,
  imageAt: Ptr,
  length: U32,
): I32 => {
  // Reject overlapping, overflowing or non-user segments before adding page mappings. Only then copy file bytes and leave the remainder zero-filled.
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER || length > size || flags > 7 ||
      !thistleImageContains(memory, imageAt, length)) return THISTLE_THX_SECTION;
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  const end = address + size;
  if (address < 0x10000n || end < address || end > top) return THISTLE_THX_SECTION;
  const count = loadU32(memory, proc + P_SEGMENT_COUNT);
  const capacity = loadU32(memory, THISTLE_CONTROL_BASE + C_SEGMENT_CAPACITY);
  if (count >= capacity) return THISTLE_THX_SECTION;
  const table = loadU32(memory, proc + P_SEGMENT_TABLE);
  let index: U32 = 0;
  while (index < count) {
    const segment = table + index * THISTLE_SEGMENT_STRIDE;
    const left = loadU64(memory, segment + S_ADDRESS);
    const right = loadU64(memory, segment + S_END);
    if (address < right && end > left) return THISTLE_THX_SECTION;
    if (loadU32(memory, segment + S_NAME_HASH) === nameHash &&
        loadU32(memory, segment + S_NAME_LENGTH) === nameLength) return THISTLE_THX_SECTION;
    index += 1;
  }
  if (length > 0 && !guestWritable(memory, hart, address, length)) return THISTLE_THX_MEMORY;
  let copied: U32 = 0;
  while (copied < length) {
    const guest = address + ux(word(copied));
    const frame = guestPage(memory, hart, guest, false);
    if (frame === INVALID_POINTER || frame === UNMAPPED_POINTER) return THISTLE_THX_MEMORY;
    const within = wordToU32(guest & 0xffffn);
    const remaining = length - copied;
    const room = THISTLE_GUEST_PAGE_SIZE - within;
    const amount = room < remaining ? room : remaining;
    let offset: U32 = 0;
    while (offset < amount) {
      storeU8(memory, frame + within + offset, word(loadU8(memory, imageAt + copied + offset)));
      offset += 1;
    }
    copied += amount;
  }
  const segment = table + count * THISTLE_SEGMENT_STRIDE;
  storeU64(memory, segment + S_ADDRESS, address);
  storeU64(memory, segment + S_END, end);
  storeU32(memory, segment + S_FLAGS, flags);
  storeU32(memory, segment + S_NAME_HASH, nameHash);
  storeU32(memory, segment + S_NAME_LENGTH, nameLength);
  atomicStoreI32(memory, proc + P_SEGMENT_COUNT, wordToI32(word(count + 1)));
  const floor = atomicLoadU64(memory, proc + P_IMAGE_FLOOR);
  if (end > floor) {
    atomicStoreU64(memory, proc + P_IMAGE_FLOOR, end);
    storeU64(memory, hartAt(hart) + H_IMAGE_FLOOR, end);
  }
  return THISTLE_THX_OK;
};

export const thistleImageFinish = (memory: ThistleMemory, hart: U32, imageBytes: U32): I32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER) return THISTLE_THX_MEMORY;
  const count = loadU32(memory, proc + P_SEGMENT_COUNT);
  const table = loadU32(memory, proc + P_SEGMENT_TABLE);
  const entry = atomicLoadU64(memory, proc + P_IMAGE_ENTRY);
  let index: U32 = 0;
  let executable = false;
  while (index < count) {
    const segment = table + index * THISTLE_SEGMENT_STRIDE;
    if ((loadU32(memory, segment + S_FLAGS) & THISTLE_SEGMENT_EXECUTE) !== 0 &&
        entry >= loadU64(memory, segment + S_ADDRESS) && entry < loadU64(memory, segment + S_END)) executable = true;
    index += 1;
  }
  if (!executable) return THISTLE_THX_SECTION;
  const floor = atomicLoadU64(memory, proc + P_IMAGE_FLOOR);
  const heap = floor + 4095n & -4096n;
  atomicStoreU64(memory, proc + P_BRK_BASE, floor);
  atomicStoreU64(memory, proc + P_BRK, heap);
  bump(memory, hartAt(hart) + H_IMAGE_LOADS);
  atomicAddU64(memory, hartAt(hart) + H_IMAGE_BYTES, ux(word(imageBytes)));
  return THISTLE_THX_OK;
};

export const thistleStackPrepare = (memory: ThistleMemory, hart: U32, bottom: U64, stackPointer: U64): I32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER) return THISTLE_START_MEMORY;
  const top = atomicLoadU64(memory, proc + P_VIRTUAL_TOP);
  if (bottom >= stackPointer || stackPointer >= top || top - stackPointer > 0x7fffffffn) return THISTLE_START_RANGE;
  const length = wordToU32(top - stackPointer);
  if (!guestWritable(memory, hart, stackPointer, length)) return THISTLE_START_MEMORY;
  let cleared: U32 = 0;
  while (cleared < length) {
    const guest = stackPointer + ux(word(cleared));
    const frame = guestPage(memory, hart, guest, false);
    if (frame === INVALID_POINTER || frame === UNMAPPED_POINTER) return THISTLE_START_MEMORY;
    const within = wordToU32(guest & 0xffffn);
    const remaining = length - cleared;
    const room = THISTLE_GUEST_PAGE_SIZE - within;
    const amount = room < remaining ? room : remaining;
    fill(memory, frame + within, amount, 0);
    cleared += amount;
  }
  atomicStoreU64(memory, proc + P_STACK_BOTTOM, bottom);
  atomicStoreU64(memory, proc + P_STACK_POINTER, stackPointer);
  storeU64(memory, hartAt(hart) + H_STACK_BOTTOM, bottom);
  storeU64(memory, hartAt(hart) + H_STACK_POINTER, stackPointer);
  return THISTLE_START_OK;
};

export const thistleStackCopy = (
  memory: ThistleMemory,
  hart: U32,
  destination: U64,
  source: Ptr,
  length: U32,
): I32 => {
  if (!thistleImageContains(memory, source, length)) return THISTLE_START_FORMAT;
  if (length > 0 && !guestWritable(memory, hart, destination, length)) return THISTLE_START_MEMORY;
  let copied: U32 = 0;
  while (copied < length) {
    const guest = destination + ux(word(copied));
    const frame = guestPage(memory, hart, guest, false);
    if (frame === INVALID_POINTER || frame === UNMAPPED_POINTER) return THISTLE_START_MEMORY;
    const within = wordToU32(guest & 0xffffn);
    const remaining = length - copied;
    const room = THISTLE_GUEST_PAGE_SIZE - within;
    const amount = room < remaining ? room : remaining;
    let offset: U32 = 0;
    while (offset < amount) {
      storeU8(memory, frame + within + offset, word(loadU8(memory, source + copied + offset)));
      offset += 1;
    }
    copied += amount;
  }
  return THISTLE_START_OK;
};

export const thistleStackStoreU64 = (memory: ThistleMemory, hart: U32, address: U64, value: U64): I32 =>
  guestStoreU64(memory, hart, address, value, 8) ? THISTLE_START_OK : THISTLE_START_MEMORY;

export const thistleStackAux = (memory: ThistleMemory, hart: U32, at: U64, random: U64, exec: U64): I32 => {
  // Construct the Linux auxiliary vector from the image and process metadata. Every pair must fit in writable guest stack memory; terminate with AT_NULL.
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER) return THISTLE_START_MEMORY;
  const ruid = u32word(word(atomicLoadI32(memory, proc + P_RUID)));
  const euid = u32word(word(atomicLoadI32(memory, proc + P_EUID)));
  const rgid = u32word(word(atomicLoadI32(memory, proc + P_RGID)));
  const egid = u32word(word(atomicLoadI32(memory, proc + P_EGID)));
  const secure = ruid !== euid || rgid !== egid ? 1n : 0n;
  let cursor = at;
  if (!guestStoreU64(memory, hart, cursor, 3n, 8) || !guestStoreU64(memory, hart, cursor + 8n, atomicLoadU64(memory, proc + P_PHDR), 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 4n, 8) || !guestStoreU64(memory, hart, cursor + 8n, u32word(word(atomicLoadI32(memory, proc + P_PHENT))), 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 5n, 8) || !guestStoreU64(memory, hart, cursor + 8n, u32word(word(atomicLoadI32(memory, proc + P_PHNUM))), 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 6n, 8) || !guestStoreU64(memory, hart, cursor + 8n, 4096n, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 7n, 8) || !guestStoreU64(memory, hart, cursor + 8n, 0n, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 8n, 8) || !guestStoreU64(memory, hart, cursor + 8n, 0n, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 9n, 8) || !guestStoreU64(memory, hart, cursor + 8n, atomicLoadU64(memory, proc + P_IMAGE_ENTRY), 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 11n, 8) || !guestStoreU64(memory, hart, cursor + 8n, ruid, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 12n, 8) || !guestStoreU64(memory, hart, cursor + 8n, euid, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 13n, 8) || !guestStoreU64(memory, hart, cursor + 8n, rgid, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 14n, 8) || !guestStoreU64(memory, hart, cursor + 8n, egid, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 23n, 8) || !guestStoreU64(memory, hart, cursor + 8n, secure, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 25n, 8) || !guestStoreU64(memory, hart, cursor + 8n, random, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 31n, 8) || !guestStoreU64(memory, hart, cursor + 8n, exec, 8)) return THISTLE_START_MEMORY;
  cursor += 16n;
  if (!guestStoreU64(memory, hart, cursor, 0n, 8) || !guestStoreU64(memory, hart, cursor + 8n, 0n, 8)) return THISTLE_START_MEMORY;
  return THISTLE_START_OK;
};

export const thistleStackFinish = (memory: ThistleMemory, hart: U32, stackPointer: U64): I32 => {
  const proc = validHart(memory, hart) ? processForHart(memory, hart) : INVALID_POINTER;
  if (proc === INVALID_POINTER || stackPointer !== atomicLoadU64(memory, proc + P_STACK_POINTER)) return THISTLE_START_MEMORY;
  setX(memory, hart, 2, sx(stackPointer, 64));
  bump(memory, hartAt(hart) + H_STARTUP_LOADS);
  return THISTLE_START_OK;
};

const fault = (memory: ThistleMemory, hart: U32, code: I32, instruction: U32): I32 => {
  const at = hartAt(hart);
  storeI32(memory, at + H_FAULT, code);
  storeU32(memory, at + H_LAST_INSTRUCTION, instruction);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_FAULTED);
  return THISTLE_BATCH_FAULT;
};

const immediateI = (instruction: U32): I64 => word(rv64ImmediateI(instruction));
const immediateS = (instruction: U32): I64 => word(rv64ImmediateS(instruction));
const immediateB = (instruction: U32): I64 => word(rv64ImmediateB(instruction));
const immediateU = (instruction: U32): I64 => word(rv64ImmediateU(instruction));
const immediateJ = (instruction: U32): I64 => word(rv64ImmediateJ(instruction));
const compressedJump = (instruction: U32): I64 => word(rv64CompressedJump(instruction));

const loadInteger = (
  memory: ThistleMemory,
  hart: U32,
  register: U32,
  funct3: U32,
  address: I64,
): boolean => {
  const size = funct3 === 0 || funct3 === 4 ? 1 : funct3 === 1 || funct3 === 5 ? 2 : funct3 === 2 || funct3 === 6 ? 4 : funct3 === 3 ? 8 : 0;
  if (size === 0 || !guestAllowed(memory, hart, ux(address), size, THISTLE_SEGMENT_READ)) return false;
  const value = guestLoadU64(memory, hart, ux(address), size);
  setX(memory, hart, register, sx(value, funct3 === 0 ? 8 : funct3 === 1 ? 16 : funct3 === 2 ? 32 : 64));
  return true;
};

const storeInteger = (
  memory: ThistleMemory,
  hart: U32,
  funct3: U32,
  address: I64,
  value: I64,
): boolean => {
  const size = funct3 === 0 ? 1 : funct3 === 1 ? 2 : funct3 === 2 ? 4 : funct3 === 3 ? 8 : 0;
  return size !== 0 && guestAllowed(memory, hart, ux(address), size, THISTLE_SEGMENT_WRITE) &&
    guestStoreU64(memory, hart, ux(address), ux(value), size);
};

const loadFloating = (
  memory: ThistleMemory,
  hart: U32,
  register: U32,
  funct3: U32,
  address: I64,
): boolean => {
  const size = funct3 === 2 ? 4 : funct3 === 3 ? 8 : 0;
  if (size === 0 || !guestAllowed(memory, hart, ux(address), size, THISTLE_SEGMENT_READ)) return false;
  const value = guestLoadU64(memory, hart, ux(address), size);
  if (funct3 === 2) setF(memory, hart, register, 0xffffffff00000000n | u32word(value));
  else setF(memory, hart, register, value);
  return true;
};

const storeFloating = (
  memory: ThistleMemory,
  hart: U32,
  register: U32,
  funct3: U32,
  address: I64,
): boolean => {
  const size = funct3 === 2 ? 4 : funct3 === 3 ? 8 : 0;
  return size !== 0 && guestAllowed(memory, hart, ux(address), size, THISTLE_SEGMENT_WRITE) &&
    guestStoreU64(memory, hart, ux(address), f(memory, hart, register), size);
};

const floatingRaw = (memory: ThistleMemory, hart: U32, register: U32, single: boolean): U64 => {
  const value = f(memory, hart, register);
  if (!single) return value;
  return value >> 32n === 0xffffffffn ? value & 0xffffffffn : 0x7fc00000n;
};

const floatingValue = (memory: ThistleMemory, hart: U32, register: U32, single: boolean): F64 => {
  const raw = floatingRaw(memory, hart, register, single);
  const scratch = hartAt(hart) + H_FLOAT_SCRATCH;
  return single ? bitsToF32(memory, scratch, raw) : bitsToF64(memory, scratch, raw);
};

const putFloatingBits = (memory: ThistleMemory, hart: U32, register: U32, value: U64, single: boolean): void => {
  setF(memory, hart, register, single ? 0xffffffff00000000n | u32word(value) : ux(value));
};

const putFloating = (memory: ThistleMemory, hart: U32, register: U32, value: F64, single: boolean): void => {
  const scratch = hartAt(hart) + H_FLOAT_SCRATCH;
  putFloatingBits(memory, hart, register, single ? f32ToBits(memory, scratch, roundF32(value)) : f64ToBits(memory, scratch, value), single);
};

const floatingRoundMode = (memory: ThistleMemory, hart: U32, encoded: U32): I32 => {
  const mode = encoded === 7 ? loadU32(memory, hartAt(hart) + H_FCSR) >>> 5 & 7 : encoded;
  return mode > 4 ? -1 : mode;
};

const setFloatingFlags = (memory: ThistleMemory, hart: U32, flags: U32): void => {
  const at = hartAt(hart) + H_FCSR;
  storeU32(memory, at, loadU32(memory, at) | flags & 31);
};

const floatingClass = (memory: ThistleMemory, hart: U32, register: U32, single: boolean): I64 =>
  rv64FloatClass(floatingRaw(memory, hart, register, single), single ? 32 : 64);

const floatingToInteger = (
  memory: ThistleMemory,
  hart: U32,
  value: F64,
  bits: I32,
  unsigned: boolean,
  mode: I32,
): I64 => {
  let rounded: F64;
  const lower = floatFloor(value);
  const fraction = value - lower;
  const nearest = fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : mode === 4 ? value < 0 ? lower : lower + 1 : floatTrunc(lower / 2) * 2 === lower ? lower : lower + 1;
  rounded = mode === 1 ? floatTrunc(value) : mode === 2 ? lower : mode === 3 ? floatCeil(value) : nearest;
  if (floatIsNaN(rounded)) {
    setFloatingFlags(memory, hart, 16);
    return unsigned ? bits === 32 ? sx(0xffffffffn, 64) : -1n : bits === 32 ? 0x7fffffffn : 0x7fffffffffffffffn;
  }
  // Floating-point limits use exclusive upper bounds: f64 cannot represent
  // INT64_MAX exactly, and integer literals must not undergo native coercion.
  const minimum: F64 = unsigned ? 0.0 : bits === 32 ? -2.147483648e9 : -9.223372036854776e18;
  const exclusiveMaximum: F64 = unsigned ? (bits === 64 ? 1.8446744073709552e19 : 4.294967296e9) : bits === 32 ? 2.147483648e9 : 9.223372036854776e18;
  if (rounded < minimum) {
    setFloatingFlags(memory, hart, 16);
    return unsigned ? 0n : bits === 32 ? -2147483648n : -0x8000000000000000n;
  }
  if (rounded >= exclusiveMaximum) {
    setFloatingFlags(memory, hart, 16);
    return unsigned ? bits === 32 ? sx(0xffffffffn, 64) : -1n : bits === 32 ? 0x7fffffffn : 0x7fffffffffffffffn;
  }
  return unsigned ? sx(floatToU64(rounded), 64) : floatToI64(rounded);
};

const floatingMultiplyAdd = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const opcode = instruction & 0x7f;
  const destination = instruction >>> 7 & 31;
  const sourceA = instruction >>> 15 & 31;
  const sourceB = instruction >>> 20 & 31;
  const sourceC = instruction >>> 27 & 31;
  const format = instruction >>> 25 & 3;
  const single = format === 0;
  if (!single && format !== 1) return false;
  if (floatingRoundMode(memory, hart, instruction >>> 12 & 7) < 0) return false;
  const left = floatingValue(memory, hart, sourceA, single);
  const right = floatingValue(memory, hart, sourceB, single);
  const addend = floatingValue(memory, hart, sourceC, single);
  const result = opcode === 0x43 ? left * right + addend : opcode === 0x47 ? left * right - addend : opcode === 0x4b ? -left * right + addend : -left * right - addend;
  putFloating(memory, hart, destination, result, single);
  return true;
};

const floatingBinary = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const top = instruction >>> 25;
  const funct3 = instruction >>> 12 & 7;
  if (floatingRoundMode(memory, hart, funct3) < 0) return false;
  const single = (top & 1) === 0;
  const left = floatingValue(memory, hart, instruction >>> 15 & 31, single);
  const right = floatingValue(memory, hart, instruction >>> 20 & 31, single);
  const divide = top === 0x0c || top === 0x0d;
  if (divide && right === 0 && left !== 0) setFloatingFlags(memory, hart, 8);
  if (divide && right === 0 && left === 0) setFloatingFlags(memory, hart, 16);
  const result = top < 2 ? left + right : top < 6 ? left - right : top < 10 ? left * right : left / right;
  putFloating(memory, hart, instruction >>> 7 & 31, result, single);
  return true;
};

const floatingSign = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const funct3 = instruction >>> 12 & 7;
  if (funct3 > 2) return false;
  const single = (instruction >>> 25 & 1) === 0;
  const sign = single ? 0x80000000n : 0x8000000000000000n;
  const rawA = floatingRaw(memory, hart, instruction >>> 15 & 31, single);
  const rawB = floatingRaw(memory, hart, instruction >>> 20 & 31, single);
  const magnitude = rawA & ~sign;
  const signA = rawA & sign;
  const signB = rawB & sign;
  putFloatingBits(memory, hart, instruction >>> 7 & 31, magnitude | (funct3 === 0 ? signB : funct3 === 1 ? signB ^ sign : signA ^ signB), single);
  return true;
};

const floatingMinMax = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const funct3 = instruction >>> 12 & 7;
  if (funct3 > 1) return false;
  const single = (instruction >>> 25 & 1) === 0;
  const destination = instruction >>> 7 & 31;
  const sourceA = instruction >>> 15 & 31;
  const sourceB = instruction >>> 20 & 31;
  const left = floatingValue(memory, hart, sourceA, single);
  const right = floatingValue(memory, hart, sourceB, single);
  // Preserve the non-NaN operand's exact bits, including negative zero.
  if (floatIsNaN(left) && floatIsNaN(right)) { putFloatingBits(memory, hart, destination, single ? 0x7fc00000n : 0x7ff8000000000000n, single); return true; }
  if (floatIsNaN(left)) { putFloatingBits(memory, hart, destination, floatingRaw(memory, hart, sourceB, single), single); return true; }
  if (floatIsNaN(right)) { putFloatingBits(memory, hart, destination, floatingRaw(memory, hart, sourceA, single), single); return true; }
  putFloating(memory, hart, destination, funct3 === 1 ? floatMax(left, right) : floatMin(left, right), single);
  return true;
};

const floatingConvertPrecision = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const single = (instruction >>> 25 & 1) === 0;
  const sourceB = instruction >>> 20 & 31;
  if (sourceB !== (single ? 1 : 0) || floatingRoundMode(memory, hart, instruction >>> 12 & 7) < 0) return false;
  putFloating(memory, hart, instruction >>> 7 & 31, floatingValue(memory, hart, instruction >>> 15 & 31, !single), single);
  return true;
};

const floatingSquareRoot = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  if ((instruction >>> 20 & 31) !== 0 || floatingRoundMode(memory, hart, instruction >>> 12 & 7) < 0) return false;
  const single = (instruction >>> 25 & 1) === 0;
  putFloating(memory, hart, instruction >>> 7 & 31, floatSqrt(floatingValue(memory, hart, instruction >>> 15 & 31, single)), single);
  return true;
};

const floatingCompare = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const funct3 = instruction >>> 12 & 7;
  if (funct3 > 2) return false;
  const single = (instruction >>> 25 & 1) === 0;
  const left = floatingValue(memory, hart, instruction >>> 15 & 31, single);
  const right = floatingValue(memory, hart, instruction >>> 20 & 31, single);
  const nan = floatIsNaN(left) || floatIsNaN(right);
  if (nan && funct3 !== 2) setFloatingFlags(memory, hart, 16);
  const result = nan ? 0n : funct3 === 0 ? left <= right ? 1n : 0n : funct3 === 1 ? left < right ? 1n : 0n : left === right ? 1n : 0n;
  setX(memory, hart, instruction >>> 7 & 31, result);
  return true;
};

const floatingConvertInteger = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const sourceB = instruction >>> 20 & 31;
  const mode = floatingRoundMode(memory, hart, instruction >>> 12 & 7);
  if (sourceB > 3 || mode < 0) return false;
  const bits = sourceB < 2 ? 32 : 64;
  const value = floatingValue(memory, hart, instruction >>> 15 & 31, (instruction >>> 25 & 1) === 0);
  const result = floatingToInteger(memory, hart, value, bits, (sourceB & 1) !== 0, mode);
  setX(memory, hart, instruction >>> 7 & 31, bits === 32 ? sx(result, 32) : result);
  return true;
};

const integerConvertFloating = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const sourceB = instruction >>> 20 & 31;
  if (sourceB > 3 || floatingRoundMode(memory, hart, instruction >>> 12 & 7) < 0) return false;
  const source = x(memory, hart, instruction >>> 15 & 31);
  const value = sourceB === 0 ? wordToFloat(sx(source, 32)) : sourceB === 1 ? unsignedWordToFloat(u32word(source)) : sourceB === 2 ? wordToFloat(source) : unsignedWordToFloat(ux(source));
  putFloating(memory, hart, instruction >>> 7 & 31, value, (instruction >>> 25 & 1) === 0);
  return true;
};

const floatingMoveClass = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const funct3 = instruction >>> 12 & 7;
  if ((instruction >>> 20 & 31) !== 0 || funct3 > 1) return false;
  const single = (instruction >>> 25 & 1) === 0;
  const source = instruction >>> 15 & 31;
  const value = funct3 === 0 ? sx(floatingRaw(memory, hart, source, single), single ? 32 : 64) : floatingClass(memory, hart, source, single);
  setX(memory, hart, instruction >>> 7 & 31, value);
  return true;
};

const integerMoveFloating = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  if ((instruction >>> 20 & 31) !== 0 || (instruction >>> 12 & 7) !== 0) return false;
  const single = (instruction >>> 25 & 1) === 0;
  const value = x(memory, hart, instruction >>> 15 & 31);
  putFloatingBits(memory, hart, instruction >>> 7 & 31, single ? u32word(value) : ux(value), single);
  return true;
};

const floatingOperation = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const operation = instruction >>> 25 & 0x7e;
  if (operation === 0x00 || operation === 0x04 || operation === 0x08 || operation === 0x0c) return floatingBinary(memory, hart, instruction);
  if (operation === 0x10) return floatingSign(memory, hart, instruction);
  if (operation === 0x14) return floatingMinMax(memory, hart, instruction);
  if (operation === 0x20) return floatingConvertPrecision(memory, hart, instruction);
  if (operation === 0x2c) return floatingSquareRoot(memory, hart, instruction);
  if (operation === 0x50) return floatingCompare(memory, hart, instruction);
  if (operation === 0x60) return floatingConvertInteger(memory, hart, instruction);
  if (operation === 0x68) return integerConvertFloating(memory, hart, instruction);
  if (operation === 0x70) return floatingMoveClass(memory, hart, instruction);
  if (operation === 0x78) return integerMoveFloating(memory, hart, instruction);
  return false;
};

const branch = (funct3: U32, left: I64, right: I64): I32 =>
  rv64Branch(funct3, left, right);

const opImmediate = (
  memory: ThistleMemory,
  hart: U32,
  register: U32,
  funct3: U32,
  instruction: U32,
  left: I64,
): boolean => {
  if (rv64ImmediateOpValid(funct3, instruction) === 0) return false;
  setX(memory, hart, register, rv64ImmediateOpValue(funct3, instruction, left));
  return true;
};

const opImmediateWord = (
  memory: ThistleMemory,
  hart: U32,
  register: U32,
  funct3: U32,
  instruction: U32,
  left: I64,
): boolean => {
  if (rv64ImmediateWordValid(funct3, instruction) === 0) return false;
  setX(memory, hart, register, rv64ImmediateWordValue(funct3, instruction, left));
  return true;
};

const opRegister = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const register = instruction >>> 7 & 31;
  const funct3 = instruction >>> 12 & 7;
  const top = instruction >>> 25;
  const left = x(memory, hart, instruction >>> 15 & 31);
  const right = x(memory, hart, instruction >>> 20 & 31);
  if (rv64RegisterValid(funct3, top) === 0) return false;
  setX(memory, hart, register, rv64RegisterValue(funct3, top, left, right));
  return true;
};

const opRegisterWord = (memory: ThistleMemory, hart: U32, instruction: U32): boolean => {
  const register = instruction >>> 7 & 31;
  const funct3 = instruction >>> 12 & 7;
  const top = instruction >>> 25;
  const left = x(memory, hart, instruction >>> 15 & 31);
  const right = x(memory, hart, instruction >>> 20 & 31);
  if (rv64RegisterWordValid(funct3, top) === 0) return false;
  setX(memory, hart, register, rv64RegisterWordValue(funct3, top, left, right));
  return true;
};

const csr = (memory: ThistleMemory, hart: U32, instruction: U32, nowMicros: I64): boolean => {
  const register = instruction >>> 7 & 31;
  const funct3 = instruction >>> 12 & 7;
  const source = instruction >>> 15 & 31;
  const left = x(memory, hart, source);
  const id = instruction >>> 20;
  const writable = id >= 1 && id <= 3;
  if (!writable && id !== 0xc00 && id !== 0xc01 && id !== 0xc02) return false;
  const current = loadU32(memory, hartAt(hart) + H_FCSR);
  const old: I64 = id === 0xc01 ? nowMicros : id === 1 ? word(current & 31) : id === 2 ? word(current >>> 5 & 7) : id === 3 ? word(current & 255) : 0n;
  if (funct3 !== 1 && funct3 !== 2 && funct3 !== 3 && funct3 !== 5 && funct3 !== 6 && funct3 !== 7) return false;
  const value = funct3 >= 5 ? word(source) : sx(left, 64);
  const write = funct3 === 1 || funct3 === 5 ? value : funct3 === 2 || funct3 === 6 ? old | value : old & ~value;
  const hit = funct3 === 1 || funct3 === 5 || value !== 0n;
  if (hit && !writable) return false;
  if (hit) storeU32(memory, hartAt(hart) + H_FCSR, id === 1 ? current & ~31 | wordToU32(write & 31n) : id === 2 ? current & 31 | wordToU32(write & 7n) << 5 : wordToU32(write & 255n));
  setX(memory, hart, register, old);
  return true;
};

const storeConditional = (memory: ThistleMemory, pointer: Ptr, value: I64, narrow: boolean, success: boolean): void => {
  if (!success) return;
  if (narrow) { storeU32(memory, pointer, value); return; }
  storeI64(memory, pointer, value);
};

const atomicInstruction = (memory: ThistleMemory, hart: U32, instruction: U32): I32 => {
  const register = instruction >>> 7 & 31;
  const funct3 = instruction >>> 12 & 7;
  const address = x(memory, hart, instruction >>> 15 & 31);
  const value = x(memory, hart, instruction >>> 20 & 31);
  if (funct3 !== 2 && funct3 !== 3) return THISTLE_BATCH_FAULT;
  const size = funct3 === 2 ? 4 : 8;
  const fn = instruction >>> 27;
  const permission = fn === 2 ? THISTLE_SEGMENT_READ : THISTLE_SEGMENT_READ | THISTLE_SEGMENT_WRITE;
  if (!guestAllowed(memory, hart, ux(address), size, permission)) return THISTLE_BATCH_FAULT;
  const pointer = guestPointer(memory, hart, ux(address), size, true);
  if (pointer === INVALID_POINTER || pointer === UNMAPPED_POINTER) return THISTLE_BATCH_FAULT;
  const lockAt = THISTLE_CONTROL_BASE + C_ATOMIC_LOCK;
  if (!acquire(memory, lockAt)) return THISTLE_BATCH_CONTENDED;
  const at = hartAt(hart);
  const old = funct3 === 2 ? word(loadI32(memory, pointer)) : loadI64(memory, pointer);
  if (fn === 2 && (instruction >>> 20 & 31) !== 0) {
    release(memory, lockAt);
    return THISTLE_BATCH_FAULT;
  }
  if (fn === 2) {
    storeI64(memory, at + H_RESERVATION, address);
    setX(memory, hart, register, old);
    release(memory, lockAt);
    return THISTLE_BATCH_BUDGET;
  }
  if (fn === 3) {
    const success = loadI64(memory, at + H_RESERVATION) === address;
    storeI64(memory, at + H_RESERVATION, NO_RESERVATION);
    storeConditional(memory, pointer, value, funct3 === 2, success);
    setX(memory, hart, register, success ? 0n : 1n);
    release(memory, lockAt);
    return THISTLE_BATCH_BUDGET;
  }
  const left = funct3 === 2 ? sx(old, 32) : old;
  const right = funct3 === 2 ? sx(value, 32) : value;
  const leftUnsigned = funct3 === 2 ? u32word(old) : ux(old);
  const rightUnsigned = funct3 === 2 ? u32word(value) : ux(value);
  if (fn !== 0 && fn !== 1 && fn !== 4 && fn !== 8 && fn !== 12 && fn !== 16 && fn !== 20 && fn !== 24 && fn !== 28) {
    release(memory, lockAt);
    return THISTLE_BATCH_FAULT;
  }
  const output: I64 = fn === 0 ? left + right : fn === 1 ? right : fn === 4 ? left ^ right : fn === 8 ? left | right : fn === 12 ? left & right :
    fn === 16 ? (left < right ? left : right) : fn === 20 ? (left > right ? left : right) :
    fn === 24 ? sx(leftUnsigned < rightUnsigned ? leftUnsigned : rightUnsigned, 64) : sx(leftUnsigned > rightUnsigned ? leftUnsigned : rightUnsigned, 64);
  if (funct3 === 2) storeU32(memory, pointer, output);
  else storeI64(memory, pointer, output);
  storeI64(memory, at + H_RESERVATION, NO_RESERVATION);
  setX(memory, hart, register, old);
  release(memory, lockAt);
  return THISTLE_BATCH_BUDGET;
};

const procId = (memory: ThistleMemory, proc: Ptr, field: U32): U64 =>
  ux(word(wordToU32(word(atomicLoadI32(memory, proc + field)))));

const keepId = (value: I64): boolean => ux(value) === 0xffffffffn || ux(value) === 0xffffffffffffffffn;
const validId = (value: I64): boolean => value >= 0n && ux(value) < 0xffffffffn;

const getResId = (memory: ThistleMemory, hart: U32, proc: Ptr, group: boolean): I64 => {
  const a = ux(x(memory, hart, 10)), b = ux(x(memory, hart, 11)), c = ux(x(memory, hart, 12));
  if (a === 0n || b === 0n || c === 0n ||
      !guestAllowed(memory, hart, a, 4, THISTLE_SEGMENT_WRITE) ||
      !guestAllowed(memory, hart, b, 4, THISTLE_SEGMENT_WRITE) ||
      !guestAllowed(memory, hart, c, 4, THISTLE_SEGMENT_WRITE) ||
      !guestWritable(memory, hart, a, 4) || !guestWritable(memory, hart, b, 4) ||
      !guestWritable(memory, hart, c, 4)) return -14n;
  const first = procId(memory, proc, group ? P_RGID : P_RUID);
  const second = procId(memory, proc, group ? P_EGID : P_EUID);
  const third = procId(memory, proc, group ? P_SGID : P_SUID);
  if (!guestStoreU64(memory, hart, a, first, 4) || !guestStoreU64(memory, hart, b, second, 4) ||
      !guestStoreU64(memory, hart, c, third, 4)) return -12n;
  return 0n;
};

const getGroups = (memory: ThistleMemory, hart: U32, proc: Ptr): I64 => {
  const wideCount = ux(x(memory, hart, 10));
  if (wideCount > 65536n) return -22n;
  const count = wordToU32(word(atomicLoadI32(memory, proc + P_GROUP_COUNT)));
  if (wideCount === 0n) return word(count);
  if (wideCount < ux(word(count))) return -22n;
  const address = ux(x(memory, hart, 11));
  if (address === 0n || !guestAllowed(memory, hart, address, count * 4, THISTLE_SEGMENT_WRITE) ||
      !guestWritable(memory, hart, address, count * 4)) return -14n;
  let index: U32 = 0;
  while (index < count) {
    const gid = word(readGroup(memory, proc, index));
    if (!guestStoreU64(memory, hart, address + ux(word(index * 4)), gid, 4)) return -12n;
    index += 1;
  }
  return word(count);
};

const setGroups = (memory: ThistleMemory, hart: U32, proc: Ptr): I64 => {
  if (procId(memory, proc, P_EUID) !== 0n) return -1n;
  const wideCount = ux(x(memory, hart, 10));
  if (wideCount > 65536n) return -22n;
  const count = wordToU32(wideCount);
  const address = ux(x(memory, hart, 11));
  if (count !== 0 && (address === 0n || !guestAllowed(memory, hart, address, count * 4, THISTLE_SEGMENT_READ))) return -14n;
  if (count === 0) return word(replaceGroups(memory, proc, 0, 0));
  const input = thistleImageReserve(memory, count * 4);
  if (input === INVALID_POINTER) return -12n;
  let index: U32 = 0;
  while (index < count) {
    const value = guestLoadU64(memory, hart, address + ux(word(index * 4)), 4);
    if (value >= 0xffffffffn) { thistleImageRelease(memory, input, count * 4); return -22n; }
    storeU32(memory, input + index * 4, value);
    index += 1;
  }
  const result = replaceGroups(memory, proc, input, count);
  thistleImageRelease(memory, input, count * 4);
  return word(result);
};

// RV64 argument validation retains the native syscall error contract.
const setGuestIdentity = (memory: ThistleMemory, hart: U32, proc: Ptr, operation: U32): I64 => {
  const a = x(memory, hart, 10), b = x(memory, hart, 11), c = x(memory, hart, 12);
  if (operation >= 4 && !validId(a)) return -22n;
  if (operation < 4 && ((!keepId(a) && !validId(a)) || (!keepId(b) && !validId(b)) ||
      operation < 2 && !keepId(c) && !validId(c))) return -1n;
  return updateIdentity(memory, proc, operation, keepId(a) ? 0xffffffff : wordToU32(a),
    keepId(b) ? 0xffffffff : wordToU32(b), keepId(c) ? 0xffffffff : wordToU32(c));
};

const credentialSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I64 => {
  if (number === 143) return setGuestIdentity(memory, hart, proc, 3);
  if (number === 144) return setGuestIdentity(memory, hart, proc, 5);
  if (number === 145) return setGuestIdentity(memory, hart, proc, 2);
  if (number === 146) return setGuestIdentity(memory, hart, proc, 4);
  if (number === 147) return setGuestIdentity(memory, hart, proc, 0);
  if (number === 148) return getResId(memory, hart, proc, false);
  if (number === 149) return setGuestIdentity(memory, hart, proc, 1);
  if (number === 150) return getResId(memory, hart, proc, true);
  if (number === 151 || number === 152) return setGuestIdentity(memory, hart, proc, number === 151 ? 6 : 7);
  if (number === 158) return getGroups(memory, hart, proc);
  if (number === 159) return setGroups(memory, hart, proc);
  return -38n;
};

const internalSyscall = (memory: ThistleMemory, hart: U32, result: I64): I32 => {
  setX(memory, hart, 10, result);
  bump(memory, hartAt(hart) + H_INTERNAL_SYSCALLS);
  return THISTLE_BATCH_BUDGET;
};

const programBreak = (memory: ThistleMemory, hart: U32, proc: Ptr): I32 => {
  const lock = proc + P_LOCK;
  if (!acquire(memory, lock)) {
    setPc(memory, hart, loadU64(memory, hartAt(hart) + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  const current = atomicLoadU64(memory, proc + P_BRK);
  const requested = ux(x(memory, hart, 10));
  if (requested === 0n) {
    release(memory, lock);
    return internalSyscall(memory, hart, sx(current, 64));
  }
  const base = atomicLoadU64(memory, proc + P_BRK_BASE);
  const stack = atomicLoadU64(memory, proc + P_STACK_BOTTOM);
  let collision = false;
  const mapCount = loadU32(memory, proc + P_MAP_COUNT);
  let mapIndex: U32 = 0;
  while (mapIndex < mapCount) {
    const mapping = mapAt(memory, proc, mapIndex);
    const start = loadU64(memory, mapping + M_ADDRESS);
    if (start <= MAP_GUARD || requested >= start - MAP_GUARD) collision = true;
    mapIndex += 1;
  }
  if (requested < base || stack === 0n || requested >= stack || stack - requested <= MAP_GUARD || collision) {
    release(memory, lock);
    return internalSyscall(memory, hart, sx(current, 64));
  }
  if (requested < current) clearMappedRange(memory, proc, requested, current);
  atomicStoreU64(memory, proc + P_BRK, requested);
  release(memory, lock);
  return internalSyscall(memory, hart, sx(requested, 64));
};

const fallbackSyscall = (memory: ThistleMemory, hart: U32): I32 => {
  const at = hartAt(hart);
  const proc = processForHart(memory, hart);
  bump(memory, at + H_FALLBACK_SYSCALLS);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_WAITING);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_SYSCALL);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_WAITING);
  return THISTLE_BATCH_SYSCALL;
};

// Linux RV64 read-only file operations. The process lock precedes the VFS
// lock, and the scratch area is never exposed directly to guest memory.
const copyGuestPath = (memory: ThistleMemory, hart: U32, address: U64, scratch: Ptr): I32 => {
  let length: U32 = 0;
  while (length < THISTLE_VFS_PATH_CAPACITY) {
    const current = address + ux(word(length));
    if (current < address || !guestAllowed(memory, hart, current, 1, THISTLE_SEGMENT_READ)) return -14;
    const byte = guestLoadU8(memory, hart, current);
    if (byte < 0) return -14;
    if (byte === 0) return wordToI32(word(length));
    storeU8(memory, scratch + length, word(byte));
    length += 1;
  }
  return -36;
};

const mountedOpen = (memory: ThistleMemory, hart: U32, proc: Ptr, descriptor: I32, scratch: Ptr): I64 => {
  const length = copyGuestPath(memory, hart, ux(x(memory, hart, 11)), scratch);
  if (length < 0) return word(length);
  if (length === 0) return -2n;
  const relative = loadU8(memory, scratch) !== 47 && descriptor !== -100;
  if (relative && (descriptor < 0 || wordToU32(word(descriptor)) >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY))) return -9n;
  const dir = relative ? descriptorAt(memory, proc, wordToU32(word(descriptor))) : 0;
  const kind = relative ? loadU32(memory, dir + FD_KIND) : THISTLE_FD_DIRECTORY;
  if (relative && kind === THISTLE_FD_EMPTY) return -9n;
  if (relative && kind !== THISTLE_FD_DIRECTORY) return -20n;
  const base: U32 = relative ? loadU32(memory, dir + FD_INODE) : 0;
  return word(openPathLocked(memory, proc, base, scratch, wordToU32(word(length)), wordToU32(x(memory, hart, 12))));
};

const mountedRead = (memory: ThistleMemory, hart: U32, state: Ptr, scratch: Ptr): I64 => {
  // Directory reads must use the directory ABI. Bound regular-file reads by the remaining bytes and scratch buffer; advance the descriptor only after a successful copy.
  const status = descriptorReadStatus(memory, state);
  if (status !== 0) return word(status);
  const requested = ux(x(memory, hart, 12));
  if (requested === 0n) return 0n;
  const inode = loadU32(memory, state + FD_INODE);
  const offset = loadU64(memory, state + FD_OFFSET);
  const bounded = requested > ux(word(THISTLE_VFS_PATH_CAPACITY)) ? THISTLE_VFS_PATH_CAPACITY : wordToU32(requested);
  const length = descriptorReadCount(memory, state, bounded);
  if (length === 0) return 0n;
  const address = ux(x(memory, hart, 11));
  if (!guestAllowed(memory, hart, address, length, THISTLE_SEGMENT_WRITE) ||
      !guestWritable(memory, hart, address, length)) return -14n;
  const result = thistleVfsReadScratch(memory, inode, offset, length);
  if (result < 0) return word(result);
  let copied: U32 = 0;
  while (copied < wordToU32(word(result))) {
    if (!guestStoreU64(memory, hart, address + ux(word(copied)), ux(word(loadU8(memory, scratch + copied))), 1)) break;
    copied += 1;
  }
  if (copied === 0 && result > 0) return -14n;
  storeU64(memory, state + FD_OFFSET, offset + ux(word(copied)));
  return word(copied);
};

const mountedFileLocked = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I64 => {
  const descriptor = wordToI32(x(memory, hart, 10));
  const scratch = loadU32(memory, THISTLE_CONTROL_BASE + C_VFS_SCRATCH_BASE);
  if (number === 56) return mountedOpen(memory, hart, proc, descriptor, scratch);
  if (descriptor < 0 || wordToU32(word(descriptor)) >= loadU32(memory, proc + P_DESCRIPTOR_CAPACITY)) return -9n;
  const state = descriptorAt(memory, proc, wordToU32(word(descriptor)));
  const kind = loadU32(memory, state + FD_KIND);
  if (kind === THISTLE_FD_EMPTY) return -9n;
  if (number === 57) { releaseDescriptor(memory, state); return 0n; }
  if (number === 63) return mountedRead(memory, hart, state, scratch);
  return -38n;
};

const mountedSeek = (memory: ThistleMemory, hart: U32): I32 => {
  const descriptor = wordToU32(x(memory, hart, 10));
  if (thistleDescriptorKind(memory, hart, descriptor) === THISTLE_FD_HOST) return internalSyscall(memory, hart, -29n);
  return internalSyscall(memory, hart, thistleSeekDescriptor(memory, hart, descriptor, x(memory, hart, 11), wordToU32(x(memory, hart, 12))));
};

const mountedFileSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  if (number === 62) return mountedSeek(memory, hart);
  const lock = proc + P_LOCK;
  const vfsLock = THISTLE_CONTROL_BASE + C_VFS_LOCK;
  if (!acquire(memory, lock)) return internalSyscall(memory, hart, -11n);
  if (!acquire(memory, vfsLock)) {
    release(memory, lock);
    return internalSyscall(memory, hart, -11n);
  }
  const result = mountedFileLocked(memory, hart, proc, number);
  release(memory, vfsLock);
  release(memory, lock);
  return internalSyscall(memory, hart, result);
};

const exitProcess = (memory: ThistleMemory, hart: U32, proc: Ptr): I32 => {
  const at = hartAt(hart);
  const code = wordToI32(x(memory, hart, 10));
  storeI32(memory, at + H_EXIT_CODE, code);
  if (proc !== INVALID_POINTER) {
    atomicStoreI32(memory, proc + P_EXIT_CODE, code);
    atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_ZOMBIE);
  }
  setX(memory, hart, 10, word(code));
  bump(memory, at + H_INTERNAL_SYSCALLS);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_EXITED);
  return THISTLE_BATCH_EXITED;
};

const readHostConsole = (memory: ThistleMemory, hart: U32, proc: Ptr, mountedVfs: boolean): I32 => {
  const at = hartAt(hart);
  const descriptor = wordToI32(x(memory, hart, 10));
  if (descriptor !== 0) return fallbackSyscall(memory, hart);
  if (mountedVfs && thistleDescriptorKind(memory, hart, 0) !== THISTLE_FD_HOST) return internalSyscall(memory, hart, -9n);
  if (ux(x(memory, hart, 12)) === 0n) return internalSyscall(memory, hart, 0n);
  const address = ux(x(memory, hart, 11));
  if (!guestAllowed(memory, hart, address, 1, THISTLE_SEGMENT_WRITE) ||
      !guestWritable(memory, hart, address, 1)) return internalSyscall(memory, hart, -14n);
  // A single-byte short read is valid; completion never writes outside it.
  storeI32(memory, at + H_HOST_OPERATION, THISTLE_HOST_READ);
  storeI32(memory, at + H_HOST_DESCRIPTOR, descriptor);
  storeU64(memory, at + H_HOST_ADDRESS, address);
  storeU32(memory, at + H_HOST_LENGTH, 1);
  bump(memory, at + H_HOST_REQUESTS);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_HOST);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_WAITING);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_WAITING);
  return THISTLE_BATCH_HOST;
};

const writeHostConsole = (memory: ThistleMemory, hart: U32, proc: Ptr, mountedVfs: boolean): I32 => {
  const at = hartAt(hart);
  const descriptor = wordToI32(x(memory, hart, 10));
  const address = ux(x(memory, hart, 11));
  const wideLength = ux(x(memory, hart, 12));
  if (mountedVfs && (thistleDescriptorKind(memory, hart, wordToU32(word(descriptor))) !== THISTLE_FD_HOST || (descriptor !== 1 && descriptor !== 2))) return internalSyscall(memory, hart, -9n);
  if (descriptor !== 1 && descriptor !== 2) return fallbackSyscall(memory, hart);
  if (wideLength > 1048576n) return internalSyscall(memory, hart, -22n);
  const length = wordToU32(wideLength);
  if (!guestAllowed(memory, hart, address, length, THISTLE_SEGMENT_READ)) return internalSyscall(memory, hart, -14n);
  if (length === 0) return internalSyscall(memory, hart, 0n);
  storeI32(memory, at + H_HOST_OPERATION, THISTLE_HOST_WRITE);
  storeI32(memory, at + H_HOST_DESCRIPTOR, descriptor);
  storeU64(memory, at + H_HOST_ADDRESS, address);
  storeU32(memory, at + H_HOST_LENGTH, length);
  bump(memory, at + H_HOST_REQUESTS);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_HOST);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_WAITING);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_WAITING);
  return THISTLE_BATCH_HOST;
};

const mapSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  const at = hartAt(hart);
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  const lock = proc + P_LOCK;
  if (!acquire(memory, lock)) {
    setPc(memory, hart, loadU64(memory, at + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  const result = anonymousMap(memory, proc, ux(x(memory, hart, 10)), ux(x(memory, hart, 11)),
    ux(x(memory, hart, 12)), ux(x(memory, hart, 13)));
  traceMappingOperation(memory, hart, number, result);
  release(memory, lock);
  return internalSyscall(memory, hart, result);
};

const unmapSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  const at = hartAt(hart);
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  const lock = proc + P_LOCK;
  if (!acquire(memory, lock)) {
    setPc(memory, hart, loadU64(memory, at + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  if (overlapsHostFile(memory, proc, ux(x(memory, hart, 10)), ux(x(memory, hart, 11)))) {
    release(memory, lock);
    return fallbackSyscall(memory, hart);
  }
  const result = anonymousUnmap(memory, proc, ux(x(memory, hart, 10)), ux(x(memory, hart, 11)));
  traceMappingOperation(memory, hart, number, result);
  release(memory, lock);
  if (result === MAP_NOT_OWNED) return fallbackSyscall(memory, hart);
  return internalSyscall(memory, hart, result);
};

const modifyMappingSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  const at = hartAt(hart);
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  const lock = proc + P_LOCK;
  if (!acquire(memory, lock)) {
    setPc(memory, hart, loadU64(memory, at + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  const result = number === 216 ? remapMapping(memory, hart, proc, THISTLE_MAP_BACKING_ANONYMOUS) : number === 226 ?
    protectMappings(memory, proc, ux(x(memory, hart, 10)), ux(x(memory, hart, 11)), ux(x(memory, hart, 12))) :
    syncAnonymous(memory, proc, ux(x(memory, hart, 10)), ux(x(memory, hart, 11)), ux(x(memory, hart, 12)));
  traceMappingOperation(memory, hart, number, result);
  release(memory, lock);
  if (result === MAP_NOT_OWNED) return fallbackSyscall(memory, hart);
  return internalSyscall(memory, hart, result);
};

const lockedCredentialSyscall = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  const at = hartAt(hart);
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  const lock = THISTLE_CONTROL_BASE + C_CREDENTIAL_LOCK;
  if (!acquire(memory, lock)) {
    setPc(memory, hart, loadU64(memory, at + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  const changesIdentity = number >= 143 && number <= 152;
  if (changesIdentity && !acquire(memory, C_VFS_LOCK)) {
    release(memory, lock);
    setPc(memory, hart, loadU64(memory, at + H_PC) - 4n);
    return THISTLE_BATCH_CONTENDED;
  }
  const result = credentialSyscall(memory, hart, proc, number);
  if (changesIdentity) release(memory, C_VFS_LOCK);
  release(memory, lock);
  return internalSyscall(memory, hart, result);
};

// These single-word queries are lockless; retain atomic reads and unsigned ID bits.
const getProcessId = (memory: ThistleMemory, hart: U32, proc: Ptr, number: U32): I32 => {
  if (proc === INVALID_POINTER) return internalSyscall(memory, hart, -3n);
  if (number === 172 || number === 178) return internalSyscall(memory, hart, procId(memory, proc, P_PID));
  if (number === 173) return internalSyscall(memory, hart, procId(memory, proc, P_PPID));
  if (number === 174) return internalSyscall(memory, hart, procId(memory, proc, P_RUID));
  if (number === 175) return internalSyscall(memory, hart, procId(memory, proc, P_EUID));
  if (number === 176) return internalSyscall(memory, hart, procId(memory, proc, P_RGID));
  if (number === 177) return internalSyscall(memory, hart, procId(memory, proc, P_EGID));
  return fallbackSyscall(memory, hart);
};

const kernelSyscall = (memory: ThistleMemory, hart: U32): I32 => {
  const at = hartAt(hart);
  const proc = processForHart(memory, hart);
  const number = wordToU32(ux(x(memory, hart, 17)));
  bump(memory, at + H_KERNEL_SYSCALLS);
  if (sharedProcessThread(memory, hart) && number === 93) return fallbackSyscall(memory, hart);
  if (number === 93 || number === 94) return exitProcess(memory, hart, proc);
  // The mounted filesystem is authoritative, independent of the compiler target.
  // Without a mount, the embedding system owns filesystem operations.
  const mountedVfs = thistleVfsLoaded(memory);
  if (mountedVfs && (number === 56 || number === 57 || number === 62 || (number === 63 && x(memory, hart, 10) !== 0n))) {
    return mountedFileSyscall(memory, hart, proc, number);
  }
  // Opt-in native console. Hosted runtimes retain their existing syscall path.
  if (number === 63 && (loadU32(memory, THISTLE_CONTROL_BASE + C_FLAGS) & THISTLE_FLAG_HOST_STDIN) !== 0) return readHostConsole(memory, hart, proc, mountedVfs);
  if (number === 64) return writeHostConsole(memory, hart, proc, mountedVfs);
  if (number === 124) return internalSyscall(memory, hart, 0n);
  if (number === 214) return proc === INVALID_POINTER ? internalSyscall(memory, hart, -3n) : programBreak(memory, hart, proc);
  if (number === 222 && (ux(x(memory, hart, 13)) & 0x20n) !== 0n) return mapSyscall(memory, hart, proc, number);
  if (number === 215) return unmapSyscall(memory, hart, proc, number);
  if (number === 216 || number === 226 || number === 227) return modifyMappingSyscall(memory, hart, proc, number);
  if ((number >= 143 && number <= 152) || number === 158 || number === 159) return lockedCredentialSyscall(memory, hart, proc, number);
  if (sharedProcessThread(memory, hart) && number === 178) return fallbackSyscall(memory, hart);
  if (number >= 172 && number <= 178) return getProcessId(memory, hart, proc, number);
  return fallbackSyscall(memory, hart);
};

// Each compressed quadrant uses its own register and immediate layouts. Faults
// are returned before writing architectural registers for invalid encodings.
const compressedQuadrantZero = (memory: ThistleMemory, hart: U32, instruction: U32): I32 => {
  const funct = instruction >>> 13;
  const primeRd = 8 + (instruction >>> 7 & 7);
  const primeRs = 8 + (instruction >>> 2 & 7);
  const base = x(memory, hart, primeRd);
  const wideOffset = word(instruction << 1 & 0xc0 | instruction >>> 7 & 0x38);
  const narrowOffset = word(instruction << 1 & 0x40 | instruction >>> 7 & 0x38 | instruction >>> 4 & 4);
  const value = instruction >>> 1 & 0x3c0 | instruction >>> 7 & 0x30 | instruction >>> 2 & 8 | instruction >>> 4 & 4;
  if (funct === 0 && value === 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (funct === 0) { setX(memory, hart, primeRs, x(memory, hart, 2) + word(value)); return THISTLE_BATCH_BUDGET; }
  if (funct === 1) return loadFloating(memory, hart, primeRs, 3, base + wideOffset) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 2) return loadInteger(memory, hart, primeRs, 2, base + narrowOffset) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 3) return loadInteger(memory, hart, primeRs, 3, base + wideOffset) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 5) return storeFloating(memory, hart, primeRs, 3, base + wideOffset) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 6) return storeInteger(memory, hart, 2, base + narrowOffset, x(memory, hart, primeRs)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 7) return storeInteger(memory, hart, 3, base + wideOffset, x(memory, hart, primeRs)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const compressedUpperImmediate = (memory: ThistleMemory, hart: U32, instruction: U32): I32 => {
  const rd = instruction >>> 7 & 31;
  const stackOffset = sx(word(instruction >>> 3 & 0x200 | instruction >>> 2 & 0x10 | instruction << 1 & 0x40 | instruction << 4 & 0x180 | instruction << 3 & 0x20), 10);
  const upperValue = sx(word(instruction << 5 & 0x20000 | instruction << 10 & 0x1f000), 18);
  if (rd === 2 && stackOffset === 0n) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (rd !== 2 && (rd === 0 || upperValue === 0n)) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  setX(memory, hart, rd, rd === 2 ? x(memory, hart, 2) + stackOffset : upperValue);
  return THISTLE_BATCH_BUDGET;
};

const compressedArithmetic = (memory: ThistleMemory, hart: U32, instruction: U32): I32 => {
  const rd = 8 + (instruction >>> 7 & 7);
  const rs = 8 + (instruction >>> 2 & 7);
  const funct2 = instruction >>> 10 & 3;
  const shift = word((instruction >>> 7 & 0x20) | (instruction >>> 2 & 0x1f));
  const immediate = sx(shift, 6);
  const left = x(memory, hart, rd);
  const right = x(memory, hart, rs);
  const high = instruction >>> 12 & 1;
  const low = instruction >>> 5 & 3;
  if (funct2 === 0) { setX(memory, hart, rd, ux(left) >> shift); return THISTLE_BATCH_BUDGET; }
  if (funct2 === 1) { setX(memory, hart, rd, left >> shift); return THISTLE_BATCH_BUDGET; }
  if (funct2 === 2) { setX(memory, hart, rd, left & immediate); return THISTLE_BATCH_BUDGET; }
  if (high === 0 && low === 0) { setX(memory, hart, rd, left - right); return THISTLE_BATCH_BUDGET; }
  if (high === 0 && low === 1) { setX(memory, hart, rd, left ^ right); return THISTLE_BATCH_BUDGET; }
  if (high === 0 && low === 2) { setX(memory, hart, rd, left | right); return THISTLE_BATCH_BUDGET; }
  if (high === 0 && low === 3) { setX(memory, hart, rd, left & right); return THISTLE_BATCH_BUDGET; }
  if (high === 1 && low === 0) { setX(memory, hart, rd, sx(left - right, 32)); return THISTLE_BATCH_BUDGET; }
  if (high === 1 && low === 1) { setX(memory, hart, rd, sx(left + right, 32)); return THISTLE_BATCH_BUDGET; }
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const compressedQuadrantOne = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const funct = instruction >>> 13;
  const rd = instruction >>> 7 & 31;
  const primeRd = 8 + (instruction >>> 7 & 7);
  const immediate = sx(word((instruction >>> 7 & 0x20) | (instruction >>> 2 & 0x1f)), 6);
  if (funct === 0) { setX(memory, hart, rd, x(memory, hart, rd) + immediate); return THISTLE_BATCH_BUDGET; }
  if (funct === 1 && rd === 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (funct === 1) { setX(memory, hart, rd, sx(x(memory, hart, rd) + immediate, 32)); return THISTLE_BATCH_BUDGET; }
  if (funct === 2) { setX(memory, hart, rd, immediate); return THISTLE_BATCH_BUDGET; }
  if (funct === 3) return compressedUpperImmediate(memory, hart, instruction);
  if (funct === 4) return compressedArithmetic(memory, hart, instruction);
  if (funct === 5) { setPc(memory, hart, atPc + ux(compressedJump(instruction))); return THISTLE_BATCH_BUDGET; }
  const value = instruction >>> 4 & 0x100 | instruction << 1 & 0xc0 | instruction << 3 & 0x20 | instruction >>> 7 & 0x18 | instruction >>> 2 & 6;
  if (funct === 6 && x(memory, hart, primeRd) === 0n || funct === 7 && x(memory, hart, primeRd) !== 0n) setPc(memory, hart, atPc + ux(sx(word(value), 9)));
  if (funct === 6 || funct === 7) return THISTLE_BATCH_BUDGET;
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const compressedJumpRegister = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const rd = instruction >>> 7 & 31;
  const rs = instruction >>> 2 & 31;
  const high = instruction >>> 12 & 1;
  if (high === 1 && rs === 0 && rd === 0) return fault(memory, hart, THISTLE_FAULT_BREAKPOINT, instruction);
  if (rd === 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (high === 0 && rs === 0) { setPc(memory, hart, ux(x(memory, hart, rd))); return THISTLE_BATCH_BUDGET; }
  if (high === 0) { setX(memory, hart, rd, x(memory, hart, rs)); return THISTLE_BATCH_BUDGET; }
  if (rs === 0) {
    const target = ux(x(memory, hart, rd));
    setX(memory, hart, 1, sx(atPc + 2n, 64));
    setPc(memory, hart, target);
    return THISTLE_BATCH_BUDGET;
  }
  setX(memory, hart, rd, x(memory, hart, rd) + x(memory, hart, rs));
  return THISTLE_BATCH_BUDGET;
};

const compressedQuadrantTwo = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const funct = instruction >>> 13;
  const rd = instruction >>> 7 & 31;
  const rs = instruction >>> 2 & 31;
  const base = x(memory, hart, 2);
  const wideLoad = word(instruction << 4 & 0x1c0 | instruction >>> 7 & 0x20 | instruction >>> 2 & 0x18);
  const narrowLoad = word(instruction << 4 & 0xc0 | instruction >>> 7 & 0x20 | instruction >>> 2 & 0x1c);
  const wideStore = word(instruction >>> 1 & 0x1c0 | instruction >>> 7 & 0x38);
  const narrowStore = word(instruction >>> 1 & 0xc0 | instruction >>> 7 & 0x3c);
  if (funct === 0 && rd === 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (funct === 0) { setX(memory, hart, rd, ux(x(memory, hart, rd)) << word((instruction >>> 7 & 0x20) | (instruction >>> 2 & 0x1f))); return THISTLE_BATCH_BUDGET; }
  if (funct === 1) return rd !== 0 && loadFloating(memory, hart, rd, 3, base + wideLoad) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 2) return rd !== 0 && loadInteger(memory, hart, rd, 2, base + narrowLoad) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 3) return rd !== 0 && loadInteger(memory, hart, rd, 3, base + wideLoad) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 4) return compressedJumpRegister(memory, hart, instruction, atPc);
  if (funct === 5) return storeFloating(memory, hart, rs, 3, base + wideStore) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 6) return storeInteger(memory, hart, 2, base + narrowStore, x(memory, hart, rs)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (funct === 7) return storeInteger(memory, hart, 3, base + wideStore, x(memory, hart, rs)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const compressedStep = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const quadrant = instruction & 3;
  if (quadrant === 0) return compressedQuadrantZero(memory, hart, instruction);
  if (quadrant === 1) return compressedQuadrantOne(memory, hart, instruction, atPc);
  if (quadrant === 2) return compressedQuadrantTwo(memory, hart, instruction, atPc);
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const stepAtomic = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const result = atomicInstruction(memory, hart, instruction);
  // A contended instruction has not executed and must be retried at its original PC.
  if (result === THISTLE_BATCH_CONTENDED) setPc(memory, hart, atPc);
  if (result === THISTLE_BATCH_CONTENDED) return result;
  if (result === THISTLE_BATCH_FAULT) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  return THISTLE_BATCH_BUDGET;
};

const stepBranch = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const take = branch(instruction >>> 12 & 7, x(memory, hart, instruction >>> 15 & 31), x(memory, hart, instruction >>> 20 & 31));
  if (take < 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (take !== 0) setPc(memory, hart, atPc + ux(immediateB(instruction)));
  return THISTLE_BATCH_BUDGET;
};

const stepJump = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64): I32 => {
  const opcode = instruction & 0x7f;
  if (opcode === 0x67 && (instruction >>> 12 & 7) !== 0) return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  const target = opcode === 0x67 ? ux(x(memory, hart, instruction >>> 15 & 31) + immediateI(instruction)) & ~1n : atPc + ux(immediateJ(instruction));
  setX(memory, hart, instruction >>> 7 & 31, sx(atPc + 4n, 64));
  setPc(memory, hart, target);
  return THISTLE_BATCH_BUDGET;
};

const stepSystem = (memory: ThistleMemory, hart: U32, instruction: U32, nowMicros: I64): I32 => {
  if (instruction === 0x00000073) return kernelSyscall(memory, hart);
  if (instruction === 0x00100073) return fault(memory, hart, THISTLE_FAULT_BREAKPOINT, instruction);
  return csr(memory, hart, instruction, nowMicros) ?
    THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const executeInstruction = (memory: ThistleMemory, hart: U32, instruction: U32, atPc: U64, nowMicros: I64): I32 => {
  const opcode = instruction & 0x7f;
  const destination = instruction >>> 7 & 31;
  const funct3 = instruction >>> 12 & 7;
  const sourceA = instruction >>> 15 & 31;
  const sourceB = instruction >>> 20 & 31;
  const left = x(memory, hart, sourceA);
  const right = x(memory, hart, sourceB);
  // Loads and stores distinguish address faults from invalid arithmetic encodings.
  if (opcode === 0x03) return loadInteger(memory, hart, destination, funct3, left + immediateI(instruction)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (opcode === 0x07) return loadFloating(memory, hart, destination, funct3, left + immediateI(instruction)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (opcode === 0x0f) return THISTLE_BATCH_BUDGET;
  if (opcode === 0x13) return opImmediate(memory, hart, destination, funct3, instruction, left) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x17) { setX(memory, hart, destination, sx(atPc + ux(immediateU(instruction)), 64)); return THISTLE_BATCH_BUDGET; }
  if (opcode === 0x1b) return opImmediateWord(memory, hart, destination, funct3, instruction, left) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x23) return storeInteger(memory, hart, funct3, left + immediateS(instruction), right) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (opcode === 0x27) return storeFloating(memory, hart, sourceB, funct3, left + immediateS(instruction)) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_MEMORY, instruction);
  if (opcode === 0x2f) return stepAtomic(memory, hart, instruction, atPc);
  if (opcode === 0x33) return opRegister(memory, hart, instruction) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x37) { setX(memory, hart, destination, immediateU(instruction)); return THISTLE_BATCH_BUDGET; }
  if (opcode === 0x3b) return opRegisterWord(memory, hart, instruction) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x43 || opcode === 0x47 || opcode === 0x4b || opcode === 0x4f) return floatingMultiplyAdd(memory, hart, instruction) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x53) return floatingOperation(memory, hart, instruction) ? THISTLE_BATCH_BUDGET : fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
  if (opcode === 0x63) return stepBranch(memory, hart, instruction, atPc);
  if (opcode === 0x67 || opcode === 0x6f) return stepJump(memory, hart, instruction, atPc);
  if (opcode === 0x73) return stepSystem(memory, hart, instruction, nowMicros);
  return fault(memory, hart, THISTLE_FAULT_INSTRUCTION, instruction);
};

const step = (memory: ThistleMemory, hart: U32, nowMicros: I64): I32 => {
  const base = hartAt(hart);
  const atPc = loadU64(memory, base + H_PC);
  if (!guestAllowed(memory, hart, atPc, 2, THISTLE_SEGMENT_EXECUTE)) return fault(memory, hart, THISTLE_FAULT_MEMORY, 0);
  const half = wordToU32(guestLoadU64(memory, hart, atPc, 2));
  if ((half & 3) !== 3) {
    setPc(memory, hart, atPc + 2n);
    return compressedStep(memory, hart, half, atPc);
  }
  if (!guestAllowed(memory, hart, atPc, 4, THISTLE_SEGMENT_EXECUTE)) return fault(memory, hart, THISTLE_FAULT_MEMORY, 0);
  const instruction = wordToU32(guestLoadU64(memory, hart, atPc, 4));
  storeU32(memory, base + H_LAST_INSTRUCTION, instruction);
  setPc(memory, hart, atPc + 4n);
  return executeInstruction(memory, hart, instruction, atPc, nowMicros);
};

const runHartLocked = (
  memory: ThistleMemory,
  hart: U32,
  budget: U32,
  nowMicros: I64,
  worker: I32,
): I32 => {
  const at = hartAt(hart);
  bump(memory, at + H_HOST_TO_WASM);
  const previousWorker = loadI32(memory, at + H_LAST_WORKER);
  if (previousWorker >= 0 && previousWorker !== worker) bump(memory, at + H_MIGRATIONS);
  storeI32(memory, at + H_LAST_WORKER, worker);
  atomicAddI32(memory, THISTLE_CONTROL_BASE + C_ACTIVE_WORKERS, 1);
  let result = THISTLE_BATCH_BUDGET;
  let count: U32 = 0;
  const status = atomicLoadI32(memory, at + H_STATUS);
  if (status !== THISTLE_HART_RUNNABLE) result = status === THISTLE_HART_EXITED ? THISTLE_BATCH_EXITED : status === THISTLE_HART_FAULTED ? THISTLE_BATCH_FAULT : THISTLE_BATCH_BUSY;
  if (status === THISTLE_HART_RUNNABLE) {
    while (count < budget && result === THISTLE_BATCH_BUDGET) {
      result = step(memory, hart, nowMicros);
      bump(memory, at + H_INSTRUCTIONS);
      count += 1;
    }
  }
  if (result === THISTLE_BATCH_CONTENDED) bump(memory, at + H_SYNC_WAITS);
  atomicAddI32(memory, THISTLE_CONTROL_BASE + C_ACTIVE_WORKERS, -1);
  bump(memory, at + H_WASM_TO_HOST);
  if (worker >= 0 && wordToU32(word(worker)) < loadU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY)) {
    const workerState = workerAt(wordToU32(word(worker)));
    bump(memory, workerState + W_BATCHES);
    atomicAddU64(memory, workerState + W_INSTRUCTIONS, ux(word(count)));
  }
  release(memory, at + H_LOCK);
  return result;
};

export const thistleRunRv64Batch = (
  memory: ThistleMemory,
  hart: U32,
  budget: U32,
  nowMicros: I64,
  worker: I32,
): I32 => {
  if (!thistleKernelValid(memory) || !validHart(memory, hart) || budget < 1) return THISTLE_BATCH_FAULT;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) {
    bump(memory, at + H_LOCK_CONTENTION);
    return THISTLE_BATCH_BUSY;
  }
  return runHartLocked(memory, hart, budget, nowMicros, worker);
};

// A worker holds the scheduler lock only while selecting a runnable hart.
// Hart execution and host requests occur after selection so other workers can progress.
export const thistleRunSchedulerBatch = (
  memory: ThistleMemory,
  budget: U32,
  nowMicros: I64,
  worker: I32,
): I32 => {
  // Release the scheduler lock before running a claimed hart or yielding to host I/O.
  if (!thistleKernelValid(memory) || budget < 1 || worker < 0) return THISTLE_BATCH_FAULT;
  const workerId = wordToU32(word(worker));
  const workerCapacity = loadU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY);
  if (workerId >= workerCapacity) return THISTLE_BATCH_FAULT;
  const lock = THISTLE_CONTROL_BASE + C_SCHED_LOCK;
  if (!acquire(memory, lock)) {
    bump(memory, THISTLE_CONTROL_BASE + C_SCHED_CONTENTION);
    return THISTLE_BATCH_CONTENDED;
  }
  const maxHarts = loadU32(memory, THISTLE_CONTROL_BASE + C_MAX_HARTS);
  const start = loadU32(memory, THISTLE_CONTROL_BASE + C_SCHED_CURSOR) % maxHarts;
  let scan: U32 = 0;
  while (scan < maxHarts) {
    const hart = (start + scan) % maxHarts;
    const at = hartAt(hart);
    const runnable = atomicLoadI32(memory, at + H_STATUS) === THISTLE_HART_RUNNABLE;
    if (runnable && acquire(memory, at + H_LOCK)) {
        storeU32(memory, THISTLE_CONTROL_BASE + C_SCHED_CURSOR, (hart + 1) % maxHarts);
        release(memory, lock);
        bump(memory, THISTLE_CONTROL_BASE + C_SCHED_RUNS);
        bump(memory, THISTLE_CONTROL_BASE + C_SCHED_CLAIMS);
        const result = runHartLocked(memory, hart, budget, nowMicros, worker);
        return wordToI32(word((hart + 1) * 256 + (wordToU32(word(result)) & 255)));
    }
    if (runnable) bump(memory, at + H_LOCK_CONTENTION);
    scan += 1;
  }
  release(memory, lock);
  bump(memory, THISTLE_CONTROL_BASE + C_SCHED_IDLE);
  bump(memory, workerAt(workerId) + W_IDLE);
  return 0;
};

export const thistleWorkerMetric = (memory: ThistleMemory, worker: U32, offset: U32): U64 => {
  if (!thistleKernelValid(memory) || worker >= loadU32(memory, THISTLE_CONTROL_BASE + C_WORKER_CAPACITY) ||
      offset + 8 > THISTLE_WORKER_STRIDE || (offset & 7) !== 0) return 0n;
  return atomicLoadU64(memory, workerAt(worker) + offset);
};

export const thistleResumeSyscall = (memory: ThistleMemory, hart: U32, result: I64): I32 => {
  if (!validHart(memory, hart)) return THISTLE_FAULT_BAD_STATE;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return THISTLE_BATCH_BUSY;
  if (atomicLoadI32(memory, at + H_STATUS) !== THISTLE_HART_WAITING || loadI32(memory, at + H_EVENT) !== THISTLE_EVENT_SYSCALL) {
    release(memory, at + H_LOCK);
    return THISTLE_FAULT_BAD_STATE;
  }
  setX(memory, hart, 10, result);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_RUNNABLE);
  const proc = processForHart(memory, hart);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  release(memory, at + H_LOCK);
  return 0;
};

// Set during platform startup, before the first guest hart runs.
export const thistleEnableHostStdin = (memory: ThistleMemory): I32 => {
  if (!thistleKernelValid(memory)) return THISTLE_FAULT_BAD_STATE;
  storeU32(memory, THISTLE_CONTROL_BASE + C_FLAGS, loadU32(memory, THISTLE_CONTROL_BASE + C_FLAGS) | THISTLE_FLAG_HOST_STDIN);
  return 0;
};

export const thistleResumeHost = (memory: ThistleMemory, hart: U32, result: I64): I32 => {
  if (!validHart(memory, hart)) return THISTLE_FAULT_BAD_STATE;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return THISTLE_BATCH_BUSY;
  if (atomicLoadI32(memory, at + H_STATUS) !== THISTLE_HART_WAITING || loadI32(memory, at + H_EVENT) !== THISTLE_EVENT_HOST) {
    release(memory, at + H_LOCK);
    return THISTLE_FAULT_BAD_STATE;
  }
  if (loadI32(memory, at + H_HOST_OPERATION) === THISTLE_HOST_READ) {
    release(memory, at + H_LOCK);
    return THISTLE_FAULT_BAD_STATE;
  }
  setX(memory, hart, 10, result);
  storeI32(memory, at + H_HOST_OPERATION, THISTLE_HOST_NONE);
  storeI32(memory, at + H_HOST_DESCRIPTOR, -1);
  storeU64(memory, at + H_HOST_ADDRESS, 0n);
  storeU32(memory, at + H_HOST_LENGTH, 0);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_RUNNABLE);
  const proc = processForHart(memory, hart);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  release(memory, at + H_LOCK);
  return 0;
};

// Complete a pending one-byte stdin request under the hart lock.
// byte == -1 denotes EOF; other negative values are not accepted.
export const thistleResumeHostRead = (memory: ThistleMemory, hart: U32, byte: I32): I32 => {
  if (!validHart(memory, hart) || byte < -1 || byte > 255) return THISTLE_FAULT_BAD_STATE;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return THISTLE_BATCH_BUSY;
  if (atomicLoadI32(memory, at + H_STATUS) !== THISTLE_HART_WAITING ||
      loadI32(memory, at + H_EVENT) !== THISTLE_EVENT_HOST ||
      loadI32(memory, at + H_HOST_OPERATION) !== THISTLE_HOST_READ ||
      loadU32(memory, at + H_HOST_LENGTH) !== 1) {
    release(memory, at + H_LOCK);
    return THISTLE_FAULT_BAD_STATE;
  }
  const address = loadU64(memory, at + H_HOST_ADDRESS);
  let result: I64 = 0n;
  if (byte >= 0) {
    result = guestAllowed(memory, hart, address, 1, THISTLE_SEGMENT_WRITE) &&
      guestStoreU64(memory, hart, address, ux(word(byte)), 1) ? 1n : -14n;
  }
  setX(memory, hart, 10, result);
  storeI32(memory, at + H_HOST_OPERATION, THISTLE_HOST_NONE);
  storeI32(memory, at + H_HOST_DESCRIPTOR, -1);
  storeU64(memory, at + H_HOST_ADDRESS, 0n);
  storeU32(memory, at + H_HOST_LENGTH, 0);
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_RUNNABLE);
  const proc = processForHart(memory, hart);
  if (proc !== INVALID_POINTER) atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_RUNNABLE);
  release(memory, at + H_LOCK);
  return 0;
};

export const thistleExitHart = (memory: ThistleMemory, hart: U32, code: I32): I32 => {
  if (!validHart(memory, hart)) return THISTLE_FAULT_BAD_STATE;
  const at = hartAt(hart);
  if (!acquire(memory, at + H_LOCK)) return THISTLE_BATCH_BUSY;
  setX(memory, hart, 10, word(code));
  const proc = processForHart(memory, hart);
  if (proc !== INVALID_POINTER && !sharedProcessThread(memory, hart)) {
    atomicStoreI32(memory, proc + P_EXIT_CODE, code);
    atomicStoreI32(memory, proc + P_STATE, THISTLE_PROCESS_ZOMBIE);
  }
  storeI32(memory, at + H_EVENT, THISTLE_EVENT_NONE);
  atomicStoreI32(memory, at + H_STATUS, THISTLE_HART_EXITED);
  release(memory, at + H_LOCK);
  return 0;
};

export { thistleVfsCreate, thistleVfsWrite, thistleVfsWriteDescriptor, thistleVfsLink, thistleVfsUnlink, thistleVfsCanMove, thistleVfsRename, thistleVfsChmod, thistleVfsChown, thistleVfsUtime } from "./vfs-edit.js";


export { thistleProcessReap } from "./process-reap.js";
export { thistleProcessInstallCredentials, thistleProcessAttach, thistleProcessSetGroup, thistleProcessReadGroups, thistleProcessRecord, thistleNextPid, thistleProcessIdentity, thistleProcessGroups, thistleProcessUmask } from "./process-state.js";
export { thistleVfsBacking, thistleVfsBackingVersion, thistleVfsCommitBacking, thistleVfsSetQuota } from "./vfs-backing.js";

export { thistleProcessSignalMask, thistleProcessQueueSignal, thistleProcessSetHostState, thistleProcessFinish, thistleProcessPark, thistleProcessPrepareImage, thistleProcessRunImage } from "./process-host.js";
