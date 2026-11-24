// This module composes kernel, toolchain or integration-test boundaries and intentionally imports their contracts.
//@cg-expect-warning
import { errnoNumbers as eno } from "../core/errno.js";
import { hostNumber, randomFill, readString } from "./mem64.js";
import { ensure } from "../core/err.js";
import type { TerminalState } from "../io/stream.js";
import { withValue } from "../core/err.js";
import { requireValue } from "../core/err.js";
import { bad, KErr } from "../core/err.js";
import type { Errno } from "../core/err.js";
import type { Sys } from "../core/sys.js";
import { enc } from "../io/stream.js";
import type { Exe } from "../../thistle-asm/fmt.js";
import { norm } from "../fs/vfs.js";
import type { RvMemory } from "./mem64.js";
import { Fd } from "../core/proc.js";
import { RvLinuxEvents } from "./linux-events.js";
import type { StartIo } from "../core/kernel.js";
import { loadI32, loadU32 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleProcessPrepareImage, thistleProcessRunImage } from "../native/process-host.js";
import { checkNative, withImage } from "../host/native-access.js";
import { ThistleMem64 } from "../native/host-memory.js";
import type { ThistleExports } from "../native/host-exports.js";
import {
  thistleKernelValid,
  thistleGuestAccess,
  thistleHartGetX,
  thistleHartSetX,
  thistleHartGetF,
  thistleHartSetF,
  thistleHartStatus,
  thistleExitHart,
  thistleHartInit,
  thistleHartMetric,
  thistleHartPc,
  thistleHartSetPc,
  thistleHartExitCode,
  thistleHartImageFloor,
  thistleHartStackBottom,
  thistleHartStackPointer,
  thistleHartBreak,
  thistleHartVirtualTop,
  thistleGuestPage,
  thistleHostAddress,
  thistleHostDescriptor,
  thistleHostLength,
  thistleHostOperation,
  thistleKernelInit,
  thistleMapHostFile,
  thistleRemapHostFile,
  thistleUnmapHostFile,
  thistleImageRelease,
  thistleImageReserve,
  thistleImageBegin,
  thistleImageSegment,
  thistleImageFinish,
  thistleProcessInit,
  thistleProcessCount,
  thistleProcessSegmentCount,
  thistleProcessMapCount,
  thistleProcessMapAddress,
  thistleProcessMapEnd,
  thistleProcessMapProtection,
  thistleProcessSetGroup,
  thistleResolvePath,
  thistleAccessInode,
  thistleOpenPath,
  thistleReadDescriptor,
  thistleSeekDescriptor,
  thistleCloseDescriptor,
  thistleDescriptorKind,
  thistleDescriptorInode,
  thistleDescriptorOffset,
  thistleResumeHost,
  thistleResumeSyscall,
  thistleRunRv64Batch,
  thistleRunSchedulerBatch,
  thistleWorkerMetric,
} from "../native/kernel.js";
import { thistleLoadThx } from "../native/thx.js";
import { thistleBuildInitialStack } from "../native/start.js";
import {
  thistleLoadVfs,
  thistleVfsDentryCount,
  thistleVfsFileSize,
  thistleVfsGid,
  thistleVfsInodeCount,
  thistleVfsKind,
  thistleVfsLoaded,
  thistleVfsLookup,
  thistleVfsMode,
  thistleVfsNlink,
  thistleVfsReadData,
  thistleVfsRoot,
  thistleVfsUid,
} from "../native/vfs.js";
import {
  C_MAX_HARTS,
  H_FAULT,
  H_LOCK,
  H_STATUS,
  H_EVENT,
  H_RESERVATION,
  H_LAST_WORKER,
  H_STACK_POINTER,
  H_INSTRUCTIONS,
  H_LAST_INSTRUCTION,
  H_F,
  H_X,
  H_PROCESS_SLOT,
  THISTLE_BATCH_BUSY,
  THISTLE_BATCH_CONTENDED,
  THISTLE_BATCH_EXITED,
  THISTLE_BATCH_FAULT,
  THISTLE_BATCH_HOST,
  THISTLE_BATCH_SYSCALL,
  THISTLE_FAULT_BREAKPOINT,
  THISTLE_HART_BASE,
  THISTLE_HART_RUNNABLE,
  THISTLE_HART_EMPTY,
  THISTLE_HART_WAITING,
  THISTLE_HART_EXITED,
  THISTLE_HART_FAULTED,
  THISTLE_EVENT_NONE,
  THISTLE_HART_STRIDE,
  THISTLE_HOST_WRITE,
  THISTLE_STARTUP_MAGIC,
  THISTLE_START_OK,
  THISTLE_THX_OK,
  THISTLE_VFS_OK,
} from "../native/abi.js";

const MAX_IO = 64 * 1024 * 1024;
const PAGE = 4096n;
const MASK = (1n << 64n) - 1n;
const AT_FDCWD = -100;
const O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0x40, O_EXCL = 0x80, O_TRUNC = 0x200, O_APPEND = 0x400;
const O_NONBLOCK = 0x800, O_DIRECTORY = 0x10000, O_CLOEXEC = 0x80000;

const AF_UNIX = 1;
const SOCK_STREAM = 1;
const SOCK_TYPE_MASK = 0x0f;
const SOCK_CLOEXEC = 0x80000;

const TCGETS = 0x5401;
const TCSETS = 0x5402;
const TCSETSW = 0x5403;
const TCSETSF = 0x5404;
const TIOCGWINSZ = 0x5413;
const TIOCSWINSZ = 0x5414;

const LINUX_TERMIOS_SIZE = 36;
const LINUX_WINSIZE_SIZE = 8;

const terminalFromFd = (
  fd: Fd,
): TerminalState | null =>
  withValue(fd.input, value => value.tty) ??
  withValue(fd.output, value => value.tty);

interface Vf {
  x: BigInt64Array;
  f: BigUint64Array;
  pc: bigint;
  cwd: string;
  env: Map<string, string>;
  fds: Map<number, Fd>;
}

interface Seg { name: string; at: bigint; end: bigint; flg: string; }
interface MapEnt { at: bigint; end: bigint; prot: number; shared: boolean; path: string | null; off: number | null; }

interface ThistleCore {
  memory: ThistleMemory;
  exports: ThistleExports;
  label: string;
}

const THISTLE_GUEST_THREADS = 16;
type FutexWake = (result: bigint) => void;

interface ThistleThreadRuntime {
  core: ThistleCore;
  active: Set<number>;
  pending: Map<number, Promise<void>>;
  tids: Map<number, number>;
  clearTid: Map<number, bigint>;
  nextTid: number;
  failure: Error | null;
}


const sx = (n: bigint, z: number): bigint => BigInt.asIntN(z, n);
const ux = (n: bigint): bigint => BigInt.asUintN(64, n);
const al = (n: bigint, z = PAGE): bigint => (n + z - 1n) & -z;

/** RV64 is a compiler-facing Thistle64 instruction profile; Linux is not hiding underneath it. */
export class Rv64 {
  private xState: BigInt64Array<ArrayBufferLike> = new BigInt64Array(32);
  private fState: BigUint64Array<ArrayBufferLike> = new BigUint64Array(32);
  private memoryState: RvMemory | null = null;
  private nativeMemory: ThistleMemory | null = null;
  private executionActive = false;
  private get m(): RvMemory {
    if (!this.executionActive) bad("EINTR", "expired guest image");
    return requireValue(this.memoryState, "m before VM initialisation");
  }
  private set m(value: RvMemory) { this.memoryState = value; }
  private pc = 0n;
  private floor = 0n;
  private brk = 0n;
  private stackAt = 0n;
  private mapAt = 0n;
  private readonly maps: MapEnt[] = [];
  private readonly miss = new Set<number>();
  private readonly localSockets = new Set<number>();
  private thistleThreads: ThistleThreadRuntime | null = null;
  private interrupted: Promise<void> | null = null;
  private thistleActiveHart = 0;
  private readonly thistleFutexWaiters = new Map<bigint, Set<FutexWake>>();
  private readonly events: RvLinuxEvents;
  private readonly rlim = new Map<number, [bigint, bigint]>();
  private done = false;
  private code = 0;
  private readonly ins = new Map<number, { b: Uint8Array; at: number }>(null);
  private readonly seg: Seg[] = [];
  private vf: Vf | null = null;

  constructor(private readonly s: Sys) {
    this.events = new RvLinuxEvents(s, () => this.m, (at, size, wr) => this.mem(at, size, wr));
  }

  get x(): BigInt64Array<ArrayBufferLike> { return this.xState; }
  get f(): BigUint64Array<ArrayBufferLike> { return this.fState; }

  // This is a host adapter. The pinned Thistle native kernel owns guest instruction execution.
  async run(exe: Exe, argv: string[], image: Uint8Array | null = null): Promise<number> {
    return this.runThistleSource(exe, argv, image);
  }

  private async runThistleSource(exe: Exe, argv: string[], image: Uint8Array | null = null): Promise<number> {
    const memory = this.s.k.canonical.memory;
    const physicalBytes = memory.bytes.length;
    this.thistleActiveHart = this.s.p.native.hart;
    this.nativeMemory = memory;
    const exports: ThistleExports = {
      thistleKernelInit: (_memory, maxHarts, threaded) => thistleKernelInit(memory, maxHarts, threaded !== 0),
      thistleKernelValid: () => thistleKernelValid(memory) ? 1 : 0,
      thistleHartInit: (_memory, hart, virtualTop, pc) => thistleHartInit(memory, hart, virtualTop, pc),
      // The fixed guest/WASM ABI requires these positional scalar parameters.
      //@cg-expect-warning
      thistleProcessInit: (_memory, hart, pid, ppid, ruid, euid, suid, rgid, egid, sgid) =>
        thistleProcessInit(memory, hart, pid, ppid, ruid, euid, suid, rgid, egid, sgid),
      thistleProcessSetGroup: (_memory, hart, index, gid) => thistleProcessSetGroup(memory, hart, index, gid),
      thistleProcessCount: () => thistleProcessCount(memory),
      thistleResolvePath: (_memory, hart, start, path, length, follow) => thistleResolvePath(memory, hart, start, path, length, follow !== 0),
      thistleAccessInode: (_memory, hart, inode, bits) => thistleAccessInode(memory, hart, inode, bits),
      thistleOpenPath: (_memory, hart, start, path, length, flags) => thistleOpenPath(memory, hart, start, path, length, flags),
      thistleReadDescriptor: (_memory, hart, descriptor, output, length) => thistleReadDescriptor(memory, hart, descriptor, output, length),
      thistleSeekDescriptor: (_memory, hart, descriptor, offset, whence) => thistleSeekDescriptor(memory, hart, descriptor, offset, whence),
      thistleCloseDescriptor: (_memory, hart, descriptor) => thistleCloseDescriptor(memory, hart, descriptor),
      thistleDescriptorKind: (_memory, hart, descriptor) => thistleDescriptorKind(memory, hart, descriptor),
      thistleDescriptorInode: (_memory, hart, descriptor) => thistleDescriptorInode(memory, hart, descriptor),
      thistleDescriptorOffset: (_memory, hart, descriptor) => thistleDescriptorOffset(memory, hart, descriptor),
      thistleLoadVfs: (_memory, at, size) => thistleLoadVfs(memory, at, size),
      thistleVfsLoaded: () => thistleVfsLoaded(memory) ? 1 : 0,
      thistleVfsRoot: () => thistleVfsRoot(memory),
      thistleVfsInodeCount: () => thistleVfsInodeCount(memory),
      thistleVfsDentryCount: () => thistleVfsDentryCount(memory),
      thistleVfsKind: (_memory, inode) => thistleVfsKind(memory, inode),
      thistleVfsFileSize: (_memory, inode) => thistleVfsFileSize(memory, inode),
      thistleVfsMode: (_memory, inode) => thistleVfsMode(memory, inode),
      thistleVfsUid: (_memory, inode) => thistleVfsUid(memory, inode),
      thistleVfsGid: (_memory, inode) => thistleVfsGid(memory, inode),
      thistleVfsNlink: (_memory, inode) => thistleVfsNlink(memory, inode),
      thistleVfsLookup: (_memory, parent, name, size) => thistleVfsLookup(memory, parent, name, size),
      thistleVfsReadData: (_memory, inode, offset, output, size) => thistleVfsReadData(memory, inode, offset, output, size),
      thistleProcessSegmentCount: (_memory, hart) => thistleProcessSegmentCount(memory, hart),
      thistleProcessMapCount: (_memory, hart) => thistleProcessMapCount(memory, hart),
      thistleProcessMapAddress: (_memory, hart, index) => thistleProcessMapAddress(memory, hart, index),
      thistleProcessMapEnd: (_memory, hart, index) => thistleProcessMapEnd(memory, hart, index),
      thistleProcessMapProtection: (_memory, hart, index) => thistleProcessMapProtection(memory, hart, index),
      thistleImageReserve: (_memory, size) => thistleImageReserve(memory, size),
      thistleImageRelease: (_memory, at, size) => thistleImageRelease(memory, at, size),
      // The fixed guest/WASM ABI requires these positional scalar parameters.
      //@cg-expect-warning
      thistleImageBegin: (_memory, hart, virtualTop, entry, phdr, phent, phnum) => thistleImageBegin(memory, hart, virtualTop, entry, phdr, phent, phnum),
      // The fixed guest/WASM ABI requires these positional scalar parameters.
      //@cg-expect-warning
      thistleImageSegment: (_memory, hart, nameHash, nameLength, address, size, flags, at, length) =>
        thistleImageSegment(memory, hart, nameHash, nameLength, address, size, flags, at, length),
      thistleImageFinish: (_memory, hart, size) => thistleImageFinish(memory, hart, size),
      thistleLoadThx: (_memory, hart, at, size) => thistleLoadThx(memory, hart, at, size),
      thistleBuildInitialStack: (_memory, hart, at, size, stackBytes) => thistleBuildInitialStack(memory, hart, at, size, stackBytes),
      thistleGuestPage: (_memory, hart, address, create) => thistleGuestPage(memory, hart, address, create !== 0),
      thistleHartGetX: (_memory, hart, register) => thistleHartGetX(memory, hart, register),
      thistleHartSetX: (_memory, hart, register, value) => thistleHartSetX(memory, hart, register, value),
      thistleHartGetF: (_memory, hart, register) => thistleHartGetF(memory, hart, register),
      thistleHartSetF: (_memory, hart, register, value) => thistleHartSetF(memory, hart, register, value),
      thistleHartPc: (_memory, hart) => thistleHartPc(memory, hart),
      thistleHartVirtualTop: (_memory, hart) => thistleHartVirtualTop(memory, hart),
      thistleHartImageFloor: (_memory, hart) => thistleHartImageFloor(memory, hart),
      thistleHartStackBottom: (_memory, hart) => thistleHartStackBottom(memory, hart),
      thistleHartStackPointer: (_memory, hart) => thistleHartStackPointer(memory, hart),
      thistleHartBreak: (_memory, hart) => thistleHartBreak(memory, hart),
      thistleHartSetPc: (_memory, hart, pc) => thistleHartSetPc(memory, hart, pc),
      thistleHartStatus: (_memory, hart) => thistleHartStatus(memory, hart),
      thistleHartMetric: (_memory, hart, offset) => thistleHartMetric(memory, hart, offset),
      thistleHostOperation: (_memory, hart) => thistleHostOperation(memory, hart),
      thistleHostDescriptor: (_memory, hart) => thistleHostDescriptor(memory, hart),
      thistleHostAddress: (_memory, hart) => thistleHostAddress(memory, hart),
      thistleHostLength: (_memory, hart) => thistleHostLength(memory, hart),
      thistleHartExitCode: (_memory, hart) => thistleHartExitCode(memory, hart),
      thistleRunRv64Batch: (_memory, hart, budget, nowMicros, worker) => thistleRunRv64Batch(memory, hart, budget, nowMicros, worker),
      thistleRunSchedulerBatch: (_memory, budget, nowMicros, worker) => thistleRunSchedulerBatch(memory, budget, nowMicros, worker),
      thistleWorkerMetric: (_memory, worker, offset) => thistleWorkerMetric(memory, worker, offset),
      thistleResumeSyscall: (_memory, hart, result) => thistleResumeSyscall(memory, hart, result),
      thistleResumeHost: (_memory, hart, result) => thistleResumeHost(memory, hart, result),
      thistleExitHart: (_memory, hart, code) => thistleExitHart(memory, hart, code),
    };
    this.executionActive = true;
    const interrupt = this.bindInterrupt();
    this.interrupted = interrupt.promise;
    try {
      this.s.chk();
      return await this.runThistleCore(exe, argv, image, { memory, exports, label: "Thistle native source" }, physicalBytes);
    } finally {
      this.executionActive = false;
      interrupt.dispose();
      this.interrupted = null;
      for (const waiters of this.thistleFutexWaiters.values()) {
        for (const wake of [...waiters]) wake(-4n);
      }
    }
  }

  private bindInterrupt(): { promise: Promise<void>; dispose: () => void } {
    const signal = this.s.p.ac.signal;
    const hook = { abort: (): void => { throw new Error("interrupt hook not initialised"); } };
    const promise = new Promise<void>(resolve => {
      hook.abort = () => { this.executionActive = false; resolve(); };
      signal.addEventListener("abort", hook.abort, { once: true });
    });
    if (signal.aborted) hook.abort();
    return { promise, dispose: () => signal.removeEventListener("abort", hook.abort) };
  }

  /** Thin-host packaging for strings and the random capability consumed by Thistle. */
  private startup(argv: string[]): Uint8Array {
    const env = [...(this.s.env())].map(([key, value]) => enc(`${key}=${value}`));
    const args = argv.map(value => enc(value));
    let size = 32;
    for (const value of env) size += 4 + value.length;
    for (const value of args) size += 4 + value.length;
    if (!Number.isSafeInteger(size) || size > 0x7fffffff) bad("EFBIG", "RV64 startup block is too large");
    const output = new Uint8Array(size);
    const view = new DataView(output.buffer);
    view.setUint32(0, THISTLE_STARTUP_MAGIC, true);
    view.setUint32(4, args.length, true);
    view.setUint32(8, env.length, true);
    crypto.getRandomValues(output.subarray(16, 32));
    let at = 32;
    for (const value of [...env, ...args]) {
      view.setUint32(at, value.length, true);
      at += 4;
      output.set(value, at);
      at += value.length;
    }
    return output;
  }

  private async runThistleCore(exe: Exe, argv: string[], image: Uint8Array | null, core: ThistleCore, physicalBytes: number): Promise<number> {
    if (exe.machine !== "thistle64" || exe.isa !== "rv64gc") bad("ENOEXEC", "RV64 VM received another instruction profile");
    const raw = image ?? bad("ENOEXEC", `${core.label} needs the original THX image`);
    const { memory, exports } = core;
    checkNative(thistleProcessPrepareImage(memory, this.s.p.native.hart));
    // Hosted guests use the live canonical VFS through Sys. A read-only native
    // snapshot would hide writes and allocate a second, stale descriptor table.
    withImage(memory, raw.length, imageAt => {
      memory.bytes.set(raw, imageAt);
      const loaded = exports.thistleLoadThx(0, this.s.p.native.hart, imageAt, raw.length);
      if (loaded !== THISTLE_THX_OK) bad("ENOEXEC", `${core.label} rejected THX image (${loaded})`);
    });
    const startup = this.startup(argv), stackLimit = this.s.k.lim.stack;
    if (!Number.isSafeInteger(stackLimit) || stackLimit < 0 || stackLimit > 0xffffffff) bad("EINVAL", "invalid RV64 stack limit");
    withImage(memory, startup.length, startupAt => {
      memory.bytes.set(startup, startupAt);
      const started = exports.thistleBuildInitialStack(0, this.s.p.native.hart, startupAt, startup.length, stackLimit);
      if (started !== THISTLE_START_OK) bad("ENOEXEC", `${core.label} rejected startup block (${started})`);
    });
    this.xState = new BigInt64Array(memory.buffer, THISTLE_HART_BASE + this.s.p.native.hart * THISTLE_HART_STRIDE + H_X, 32);
    this.fState = new BigUint64Array(memory.buffer, THISTLE_HART_BASE + this.s.p.native.hart * THISTLE_HART_STRIDE + H_F, 32);
    this.m = new ThistleMem64(memory, this.s.p.native.hart, exports.thistleHartVirtualTop(0, this.s.p.native.hart), physicalBytes,
      (hart, address, create) => exports.thistleGuestPage(0, hart, address, create ? 1 : 0));
    this.thistleDescribeImage(exe);
    checkNative(thistleProcessRunImage(memory, this.s.p.native.hart));
    this.floor = exports.thistleHartImageFloor(0, this.s.p.native.hart);
    this.brk = al(this.floor);
    this.mapAt = 0x4000000000n;
    this.pc = exports.thistleHartPc(0, this.s.p.native.hart);
    this.stackAt = exports.thistleHartStackBottom(0, this.s.p.native.hart);
    return this.runThistleCooperative(core);
  }

  private thistleDescribeImage(exe: Exe): void {
    this.seg.length = 0;
    for (const section of exe.sec) {
      this.seg.push({ name: section.name, at: BigInt(section.addr), end: BigInt(section.addr) + BigInt(section.size), flg: section.flg });
    }
  }

  /** Schedule RV64 harts cooperatively with shared guest memory and individual registers. */
  private async runThistleCooperative(core: ThistleCore): Promise<number> {
    const session: ThistleThreadRuntime = { failure: null,
      core, active: new Set([this.s.p.native.hart]),
      pending: new Map<number, Promise<void>>(),
      tids: new Map([[this.s.p.native.hart, this.s.pid]]),
      clearTid: new Map<number, bigint>(), nextTid: this.s.pid + 100000,
    };
    this.thistleThreads = session;
    let fuel = this.s.k.lim.fuel;
    try {
      while (!this.done) {
        this.s.chk();
        if (session.failure) throw session.failure;
        let progressed = false;
        for (const hart of [...session.active]) {
          if (session.pending.has(hart)) continue;
          const executed = this.thistleStepHart(session, hart);
          if (executed === null) continue;
          progressed = true;
          if (fuel) {
            fuel -= Number(executed);
            ensure(!(fuel < 0), () => bad("ELOOP", "RV64 instruction limit reached"));
          }
        }
        if (this.done) break;
        if (session.failure) throw session.failure;
        if (progressed) { await this.s.yield(); continue; }
        if (session.pending.size) {
          await Promise.race([...session.pending.values(), requireValue(this.interrupted, "guest interruption")]);
          continue;
        }
        bad("EPROTO", "Thistle has no runnable harts or pending syscalls");
      }
      return this.code & 255;
    } finally {
      this.thistleThreads = null;
    }
  }

  private thistleObserveExit(session: ThistleThreadRuntime, hart: number): void {
    const code = session.core.exports.thistleHartExitCode(0, hart);
    if (hart === this.s.p.native.hart) this.exit(BigInt(code));
    else this.thistleThreadExit(hart, code);
  }

  private thistleFault(session: ThistleThreadRuntime, hart: number): never {
    const { memory } = session.core, base = THISTLE_HART_BASE + hart * THISTLE_HART_STRIDE;
    return this.thistleReportFault(session, hart, loadI32(memory, base + H_FAULT), loadU32(memory, base + H_LAST_INSTRUCTION));
  }

  private thistleStepHart(session: ThistleThreadRuntime, hart: number): bigint | null {
    const { exports } = session.core;
    const status = exports.thistleHartStatus(0, hart);
    if (status === THISTLE_HART_EXITED) { this.thistleObserveExit(session, hart); return null; }
    if (status === THISTLE_HART_FAULTED) this.thistleFault(session, hart);
    if (status !== THISTLE_HART_RUNNABLE) return null;
    const before = exports.thistleHartMetric(0, hart, H_INSTRUCTIONS);
    const result = exports.thistleRunRv64Batch(0, hart, 16384, BigInt(Date.now()) * 1000n, 0);
    const executed = exports.thistleHartMetric(0, hart, H_INSTRUCTIONS) - before;
    switch (result) {
      case THISTLE_BATCH_SYSCALL: this.thistleScheduleSyscall(session, hart); break;
      case THISTLE_BATCH_HOST: this.thistleScheduleHost(session, hart); break;
      case THISTLE_BATCH_EXITED: this.thistleObserveExit(session, hart); break;
      case THISTLE_BATCH_FAULT: this.thistleFault(session, hart);
    }
    return executed;
  }

  /** Include the guest mapping and execution registers when a hart faults. */
  private thistleReportFault(session: ThistleThreadRuntime, hart: number, fault: number, instruction: number): never {
    const { memory, exports } = session.core;
    const pc = exports.thistleHartPc(0, hart);
    const count = exports.thistleProcessMapCount(0, hart);
    let mapping = "unmapped";
    let closest = "none";
    let distance = 0x0000ffffffffffffn;

    for (let index = 0; index < count; index++) {
      const at = exports.thistleProcessMapAddress(0, hart, index);
      const end = exports.thistleProcessMapEnd(0, hart, index);
      const prot = exports.thistleProcessMapProtection(0, hart, index);
      const region = `[0x${at.toString(16)},0x${end.toString(16)}) prot=${prot}`;
      if (pc >= at && pc < end) mapping = region;
      const delta = pc < at ? at - pc : pc >= end ? pc - end : 0n;
      if (delta < distance) {
        distance = delta;
        closest = region;
      }
    }
    const ra = ux(thistleHartGetX(memory, hart, 1));
    const sp = ux(thistleHartGetX(memory, hart, 2));
    const imageSegment = (this.seg.find(segment => pc >= segment.at && pc < segment.end) ?? null);
    const image = imageSegment
      ? `${imageSegment.name} flags=${imageSegment.flg}`
      : "none";

    // A fault on C.LD is a data read, not an instruction-fetch failure.
    // The hart PC has already advanced by two bytes when the fault is raised.
    let access = "unknown";
    if (instruction <= 0xffff && (instruction & 0xe003) === 0x6000) {
      const source = 8 + (instruction >>> 7 & 7);
      const destination = 8 + (instruction >>> 2 & 7);
      const offset = (instruction << 1 & 0xc0) | (instruction >>> 7 & 0x38);
      const address = ux(thistleHartGetX(memory, hart, source) + BigInt(offset));
      const region = (this.seg.find(segment => address >= segment.at && address + 8n <= segment.end) ?? null);
      let anonymous = "unmapped";
      for (let index = 0; index < count; index++) {
        const at = exports.thistleProcessMapAddress(0, hart, index);
        const end = exports.thistleProcessMapEnd(0, hart, index);
        // Guest state updates stay inside the selected instruction or syscall path.
        //@cg-expect-warning
        if (address >= at && address + 8n <= end) {
          anonymous = `[0x${at.toString(16)},0x${end.toString(16)}) prot=${exports.thistleProcessMapProtection(0, hart, index)}`;
          break;
        }
      }
      const frame = exports.thistleGuestPage(0, hart, address, 0) >>> 0;
      access = `C.LD x${destination},${offset}(x${source}) address=0x${address.toString(16)} frame=0x${frame.toString(16)} anon=${anonymous} segment=${withValue(region ?? null, value => value.name) ?? "none"}`;
    }
    const traceView = new DataView(memory.buffer);
    // The faulting C.LD follows an earlier "ld a4, 0(a1)". Inspect the
    // source cell and the host-side file mappings before blaming mmap.
    const a1 = ux(thistleHartGetX(memory, hart, 11));
    const sourceFrame = exports.thistleGuestPage(0, hart, a1, 0) >>> 0;
    const sourceOffset = Number(a1 & 0xffffn);
    const sourceCell = sourceFrame < 0xfffffffe && sourceOffset <= 65528 &&
      sourceFrame + sourceOffset + 8 <= memory.bytes.byteLength
      ? `0x${traceView.getBigUint64(sourceFrame + sourceOffset, true).toString(16)}`
      : "unavailable";
    const guestRegisters = [10, 11, 12, 13, 14, 15, 16, 17].map(reg =>
      `x${reg}=0x${ux(thistleHartGetX(memory, hart, reg)).toString(16)}`
    ).join(",");
    const hostMappings = this.maps
      .filter(region => region.path !== null && (
        a1 >= region.at && a1 < region.end ||
        ux(thistleHartGetX(memory, hart, 14)) >= region.at &&
        ux(thistleHartGetX(memory, hart, 14)) < region.end
      ))
      .map(region => `[0x${region.at.toString(16)},0x${region.end.toString(16)}) prot=${region.prot} path=${region.path}`)
      .join(";");
    const traceCount = traceView.getUint32(1000, true);
    const cellWrites: string[] = [];
    const otherSmiWrites: string[] = [];
    const mappingEvents: string[] = [];
    const start = Math.max(0, traceCount - 48);
    for (let index = start; index < traceCount; index++) {
      const slot = 1024 + index % 48 * 40;
      const operation = traceView.getUint32(slot, true);
      const size = traceView.getUint32(slot + 4, true);
      const address = traceView.getBigUint64(slot + 8, true);
      const length = traceView.getBigUint64(slot + 16, true);
      const result = traceView.getBigInt64(slot + 24, true);
      const at = traceView.getBigUint64(slot + 32, true);
      if (operation === 0x53544f52) {
        const event = `pc=0x${at.toString(16)} addr=0x${address.toString(16)} size=${size} value=0x${ux(result).toString(16)}`;
        // Guest state updates stay inside the selected instruction or syscall path.
        //@cg-expect-warning
        if (address < a1 + 8n && address + length > a1) cellWrites.push(event);
        else otherSmiWrites.push(event);
      } else {
        mappingEvents.push(`${operation}(0x${address.toString(16)},0x${length.toString(16)})=0x${ux(result).toString(16)}`);
      }
    }
    return bad("ENOEXEC", `Thistle hart ${hart} fault ${fault} instruction 0x${instruction.toString(16)} pc=0x${pc.toString(16)} ra=0x${ra.toString(16)} sp=0x${sp.toString(16)} image=${image} mapping=${mapping} nearest=${closest} mappings=${count} access=${access} source(a1)=0x${a1.toString(16)} sourceFrame=0x${sourceFrame.toString(16)} sourceCell=${sourceCell} registers=[${guestRegisters}] hostMappings=[${hostMappings}] traceCount=${traceCount} sourceWrites=[${cellWrites.join("; ")}] recentSmiWrites=[${otherSmiWrites.slice(-12).join("; ")}] mappingEvents=[${mappingEvents.slice(-8).join("; ")}]`);
  }

  private thistleTrack(session: ThistleThreadRuntime, hart: number, work: Promise<void>): void {
    const tracked = work.catch(<T>(caughtValue: T) => { const error = caughtValue instanceof Error ? caughtValue : new Error(typeof caughtValue === "undefined" ? "undefined" : String(caughtValue));  session.failure = error;  })
      .finally(() => { session.pending.delete(hart); });
    session.pending.set(hart, tracked);
  }

  private thistleScheduleSyscall(session: ThistleThreadRuntime, hart: number): void {
    // This services a syscall requested by generated Thistle; it does not hand
    // instruction execution back to the direct TypeScript RV64 interpreter.
    const { memory, exports } = session.core;
    const base = THISTLE_HART_BASE + hart * THISTLE_HART_STRIDE;
    this.xState = new BigInt64Array(memory.buffer, base + H_X, 32);
    this.fState = new BigUint64Array(memory.buffer, base + H_F, 32);
    this.thistleActiveHart = hart;
    this.pc = exports.thistleHartPc(0, hart);
    this.brk = exports.thistleHartBreak(0, hart);
    this.syncThistleMemoryState(exports);
    const registers = this.xState;
    const pc = this.pc;
    const work = this.sys().then(() => {
      if (!this.executionActive || exports.thistleHartStatus(0, hart) !== THISTLE_HART_WAITING) return;
      if (exports.thistleHartSetPc(0, hart, ux(pc)) !== 0 ||
          exports.thistleResumeSyscall(0, hart, requireValue(registers[10] ?? null, "src/vm/rv64.ts:784")) !== 0) {
        bad("EPROTO", `Thistle hart ${hart} syscall resume failed`);
      }
    }, null);
    this.thistleTrack(session, hart, work);
  }

  private thistleScheduleHost(session: ThistleThreadRuntime, hart: number): void {
    const { exports } = session.core;
    const work = (async () => {
      const operation = exports.thistleHostOperation(0, hart);
      if (operation !== THISTLE_HOST_WRITE) bad("ENOSYS", `unsupported Thistle host operation ${operation}`);
      const descriptor = exports.thistleHostDescriptor(0, hart);
      const address = exports.thistleHostAddress(0, hart);
      const length = exports.thistleHostLength(0, hart);
      let value: bigint;
      try {
        value = BigInt(await this.write(descriptor, this.m.read(address, length)));
      } catch (caughtValue) { const error = caughtValue instanceof Error ? caughtValue : new Error(typeof caughtValue === "undefined" ? "undefined" : String(caughtValue));
        if (!(error instanceof KErr)) throw error;
        value = -BigInt(eno[error.code] ?? 5);
      }
      if (!this.executionActive) return;
      if (exports.thistleResumeHost(0, hart, value) !== 0) {
        bad("EPROTO", `Thistle hart ${hart} host resume failed`);
      }
    })();
    this.thistleTrack(session, hart, work);
  }

  private thistleCloneThread(flags: bigint, stack: bigint, parentTid: bigint, tls: bigint, childTid: bigint): bigint {
    // Thread clones share the address space; validate TID pointers before copying hart state and publishing the child.
    const session = this.thistleThreads ?? bad("EPROTO", "no Thistle thread runtime");
    const option = ux(flags);
    if ((option & 0x10000n) === 0n) return this.clone(flags, stack, tls);
    if ((option & 0x900n) !== 0x900n) return -22n;
    if (session.active.size >= THISTLE_GUEST_THREADS) return -11n;
    const { memory, exports } = session.core;
    let child = -1;
    const harts = loadU32(memory, C_MAX_HARTS);
    for (let hart = 0; hart < harts; hart++) {
      const empty = exports.thistleHartStatus(0, hart) === THISTLE_HART_EMPTY;
      const reusable = session.tids.has(hart) && !session.active.has(hart) && !session.pending.has(hart);
      if (empty || reusable) { child = hart; break; }
    }
    if (child < 0) return -11n;
    const parent = this.thistleActiveHart;
    const source = THISTLE_HART_BASE + parent * THISTLE_HART_STRIDE;
    const target = THISTLE_HART_BASE + child * THISTLE_HART_STRIDE;
    const tid = session.nextTid++;
    if ((option & 0x100000n) !== 0n) this.mem(ux(parentTid), 4, true);
    if ((option & 0x1000000n) !== 0n || (option & 0x200000n) !== 0n) this.mem(ux(childTid), 4, true);
    memory.bytes.copyWithin(target, source, source + THISTLE_HART_STRIDE);
    const view = new DataView(memory.buffer);
    view.setInt32(target + H_LOCK, 0, true);
    view.setInt32(target + H_STATUS, THISTLE_HART_RUNNABLE, true);
    view.setInt32(target + H_EVENT, THISTLE_EVENT_NONE, true);
    view.setBigInt64(target + H_RESERVATION, -1n, true);
    view.setInt32(target + H_LAST_WORKER, -1, true);
    const registers = new BigInt64Array(memory.buffer, target + H_X, 32);
    registers[10] = 0n;
    if (stack !== 0n) {
      registers[2] = sx(stack, 64);
      view.setBigUint64(target + H_STACK_POINTER, ux(stack), true);
    }
    if ((option & 0x80000n) !== 0n) registers[4] = sx(tls, 64);
    session.tids.set(child, tid);
    session.active.add(child);
    if ((option & 0x100000n) !== 0n) this.m.set32(ux(parentTid), tid);
    if ((option & 0x1000000n) !== 0n) this.m.set32(ux(childTid), tid);
    if ((option & 0x200000n) !== 0n) session.clearTid.set(child, ux(childTid));
    if (exports.thistleHartStatus(0, child) !== THISTLE_HART_RUNNABLE) bad("EPROTO", "new Thistle hart not runnable");
    return BigInt(tid);
  }

  private thistleSetClearTid(at: bigint): bigint {
    const state = this.thistleThreads ?? bad("EPROTO", "no Thistle thread runtime");
    const address = ux(at);
    if (address) { this.mem(address, 4, true); state.clearTid.set(this.thistleActiveHart, address); }
    return BigInt(state.tids.get(this.thistleActiveHart) ?? this.s.pid);
  }

  private thistleThreadExit(hart: number, code: number): void {
    const state = this.thistleThreads ?? bad("EPROTO", "no Thistle thread runtime");
    const clear = (state.clearTid.get(hart) ?? null);
    if (clear) {
      this.mem(clear, 4, true);
      this.m.set32(clear, 0);
      this.thistleWakeFutex(clear, 0x7fffffff);
      state.clearTid.delete(hart);
    }
    if (state.core.exports.thistleExitHart(0, hart, code) !== 0) bad("EPROTO", "Thistle thread exit failed");
    state.active.delete(hart);
  }

  private thistleWakeFutex(at: bigint, count: number): number {
    const queue = (this.thistleFutexWaiters.get(at) ?? null);
    if (!queue) return 0;
    let woken = 0;
    for (const wake of [...queue]) {
      if (woken >= count) break;
      wake(0n);
      woken++;
    }
    return woken;
  }

  private async thistleFutex(at0: bigint, op0: bigint, value: bigint, timeoutAt: bigint): Promise<bigint> {
    const address = ux(at0);
    const operation = this.nat(op0, "futex operation", 0x7fffffff) & 0x7f;
    this.mem(address, 4, operation !== 0 && operation !== 9);
    if (operation === 1 || operation === 10) {
      return BigInt(this.thistleWakeFutex(address, this.nat(value, "futex wake count", 0x7fffffff)));
    }
    if (operation !== 0 && operation !== 9) return -38n;
    if (this.m.u32(address) !== Number(ux(value) & 0xffffffffn)) return -11n;
    let millis: number | null = null;
    if (timeoutAt) {
      const timeout = this.readTs(ux(timeoutAt));
      millis = operation === 9 ? Math.max(0, timeout - this.clockMs((op0 & 0x100n) ? 0 : 1)) : timeout;
      // Guest state updates stay inside the selected instruction or syscall path.
      //@cg-expect-warning
      if (millis <= 0) return -110n;
    }
    return new Promise<bigint>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let queue = (this.thistleFutexWaiters.get(address) ?? null);
      if (!queue) { queue = new Set(); this.thistleFutexWaiters.set(address, queue); }
      const listeners = queue;
      const wake: FutexWake = result => {
        listeners.delete(wake);
        if (listeners.size === 0) this.thistleFutexWaiters.delete(address);
        if (timer !== null) clearTimeout(timer);
        resolve(result);
      };
      listeners.add(wake);
      if (millis !== null) timer = setTimeout(() => wake(-110n), millis);
    });
  }

  private syncThistleMemoryState(exports: ThistleExports): void {
    this.brk = exports.thistleHartBreak(0, this.s.p.native.hart);

    // Retain file-backed mappings maintained by the compatibility bridge.
    const hostOwned = this.maps.filter(
      mapping => mapping.path !== null,
    );

    this.maps.length = 0;
    this.maps.push(...hostOwned);

    const count = exports.thistleProcessMapCount(0, this.s.p.native.hart);

    for (let index = 0; index < count; index++) {
      const at = exports.thistleProcessMapAddress(0, this.s.p.native.hart, index);
      const end = exports.thistleProcessMapEnd(0, this.s.p.native.hart, index);
      const prot = exports.thistleProcessMapProtection(0, this.s.p.native.hart, index);

      if (end > at && !hostOwned.some(mapping => mapping.at === at && mapping.end === end)) {
        this.maps.push({"path": null, "off": null, at,
          end,
          prot,
          shared: false,
        });
      }
    }
  }

  private async sys(): Promise<void> {
    // Capture the originating hart: another hart may run while this syscall awaits.
    const registers = this.x;
    try {
      const result = await this.call(Number(ux(requireValue(registers[17] ?? null, "src/vm/rv64.ts:1322"))));
      if (this.executionActive) registers[10] = sx(result, 64);
    }
    catch (caughtValue) { const e = caughtValue instanceof Error ? caughtValue : new Error(typeof caughtValue === "undefined" ? "undefined" : String(caughtValue));
      if (!(e instanceof KErr)) throw e;
      if (this.executionActive) registers[10] = sx(-BigInt(eno[e.code] ?? 5), 64);
    }
  }

  private async call(n: number): Promise<bigint> {
    const a = this.x;
    switch (n) {
      case 17: { const b = enc(this.s.cwd + "\0"); return BigInt(this.copy(b, ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1332")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1332"), "getcwd length", MAX_IO))); }
      case 19: return BigInt(this.events.createEventfd(
        this.nat(requireValue(a[10] ?? null, "src/vm/rv64.ts:1334"), "eventfd initial value", 0xffffffff),
        this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1335"), "eventfd flags", 0xffffffff),
      ));
      case 20: return BigInt(this.events.createEpoll(
        this.nat(requireValue(a[10] ?? null, "src/vm/rv64.ts:1338"), "epoll flags", 0xffffffff),
      ));
      case 21: return BigInt(this.events.ctl(
        this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1341")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1341"), "epoll operation", 3),
        this.fd(requireValue(a[12] ?? null, "src/vm/rv64.ts:1342")), ux(requireValue(a[13] ?? null, "src/vm/rv64.ts:1342")),
      ));
      case 22: return BigInt(await this.events.wait(
        this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1345")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1345")),
        this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1346"), "epoll maximum events", 4096),
        Number(BigInt.asIntN(32, requireValue(a[13] ?? null, "src/vm/rv64.ts:1347"))),
      ));
      case 23: {
        const original = this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1350"));
        const duplicate = this.s.dup(original, null);
        this.events.duplicate(original, duplicate);
        return BigInt(duplicate);
      }
      case 24: return BigInt(this.dup3(requireValue(a[10] ?? null, "src/vm/rv64.ts:1355"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1355"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1355")));
      case 25: return BigInt(this.fcntl(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1356")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1356"), "fcntl command", 0x7fffffff), requireValue(a[12] ?? null, "src/vm/rv64.ts:1356")));
      case 29: return this.ioctl(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1357")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1357"), "ioctl request", 0xffffffff), ux(requireValue(a[12] ?? null, "src/vm/rv64.ts:1357")));
      case 34: this.s.mkdir(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1358"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1358"))), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1358"), "mode", 0xffff)); return 0n;
      case 35: { const p = this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1359"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1359"))); this.s.rm(p, !!(this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1359"), "unlink flags", 0xffff) & 0x200)); return 0n; }
      case 36: this.s.symlink(this.str(requireValue(a[10] ?? null, "src/vm/rv64.ts:1360")), this.path(requireValue(a[11] ?? null, "src/vm/rv64.ts:1360"), this.str(requireValue(a[12] ?? null, "src/vm/rv64.ts:1360")))); return 0n;
      case 37: this.s.link(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1361"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1361"))), this.path(requireValue(a[12] ?? null, "src/vm/rv64.ts:1361"), this.str(requireValue(a[13] ?? null, "src/vm/rv64.ts:1361")))); return 0n;
      case 38: this.s.mv(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1362"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1362"))), this.path(requireValue(a[12] ?? null, "src/vm/rv64.ts:1362"), this.str(requireValue(a[13] ?? null, "src/vm/rv64.ts:1362")))); return 0n;
      case 276: {
        const flags = this.nat(requireValue(a[14] ?? null, "src/vm/rv64.ts:1364"), "renameat2 flags", 0xffffffff);

        // Linux RENAME_NOREPLACE is useful to musl and account-management
        // transactions. Exchange and whiteout flags are explicitly unsupported.
        if (flags & ~1) {
          bad("EINVAL", "unsupported renameat2 flags");
        }

        const from = this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1372"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1372")));
        const to = this.path(requireValue(a[12] ?? null, "src/vm/rv64.ts:1373"), this.str(requireValue(a[13] ?? null, "src/vm/rv64.ts:1373")));

        if (flags & 1) {
          let exists = true;

          try {
            this.s.stat(to, false);
          } catch (caughtValue) { const error = caughtValue instanceof Error ? caughtValue : new Error(typeof caughtValue === "undefined" ? "undefined" : String(caughtValue));
            // Guest state updates stay inside the selected instruction or syscall path.
            //@cg-expect-warning
            if (!(error instanceof KErr) || error.code !== "ENOENT") {
              throw error;
            }
            exists = false;
          }

          ensure(!(exists), () => bad("EEXIST", to));
        }

        this.s.mv(from, to);
        return 0n;
      }
      case 43: this.s.stat(this.str(requireValue(a[10] ?? null, "src/vm/rv64.ts:1393"))); return this.statfs(ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1393")));
      case 44: { const fd = this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1394")); if (fd >= 3) this.s.fdStat(fd); return this.statfs(ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1394"))); }
      case 45: this.trunc(this.str(requireValue(a[10] ?? null, "src/vm/rv64.ts:1395")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1395"), "file length", this.s.k.fs.cap)); return 0n;
      case 46: { const f = this.s.p.fds.get(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1396"))) ?? bad("EBADF", String((a[10] ?? null))); this.trunc(f.path ?? bad("EBADF", String((a[10] ?? null))), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1396"), "file length", this.s.k.fs.cap)); return 0n; }
      case 48: this.s.stat(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1397"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1397")))); return 0n;
      case 49: this.s.cd(this.str(requireValue(a[10] ?? null, "src/vm/rv64.ts:1398"))); return 0n;
      case 50: { this.s.fdChdir(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1399"))); return 0n; }
      case 52: { this.s.fdChmod(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1400")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1400"), "mode", 0xffff)); return 0n; }
      case 53: this.s.chmod(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1401"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1401"))), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1401"), "mode", 0xffff)); return 0n;
      case 54: this.s.chown(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1402"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1402"))), this.owner(requireValue(a[12] ?? null, "src/vm/rv64.ts:1402"), "uid"), this.owner(requireValue(a[13] ?? null, "src/vm/rv64.ts:1402"), "gid")); return 0n;
      case 55: { this.s.fdChown(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1403")), this.owner(requireValue(a[11] ?? null, "src/vm/rv64.ts:1403"), "uid"), this.owner(requireValue(a[12] ?? null, "src/vm/rv64.ts:1403"), "gid")); return 0n; }
      case 56: return BigInt(await this.openat(requireValue(a[10] ?? null, "src/vm/rv64.ts:1404"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1404")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1404"), "open flags", 0xffffffff), this.nat(requireValue(a[13] ?? null, "src/vm/rv64.ts:1404"), "open mode", 0xffff)));
      case 57: {
        const fd = this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1406"));
        this.localSockets.delete(fd);
        this.events.close(fd);
        this.s.close(fd);
        return 0n;
      }
      case 59: {
        const at = ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1413")), fl = this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1413"), "pipe flags", 0xffffffff); this.mem(at, 8, true);
        if (fl & ~(O_CLOEXEC | O_NONBLOCK)) bad("EINVAL", "unsupported pipe flags");
        const [rd, wr] = this.s.pipe();
        if (fl & O_CLOEXEC) { requireValue(this.s.p.fds.get(rd) ?? null, "src/vm/rv64.ts:1416").clo = true; requireValue(this.s.p.fds.get(wr) ?? null, "src/vm/rv64.ts:1416").clo = true; }
        this.m.set32(at, rd); this.m.set32(at + 4n, wr); return 0n;
      }
      case 61: return BigInt(this.getdents(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1419")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1419")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1419"), "directory buffer length", MAX_IO)));
      case 62: return BigInt(this.s.seek(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1420")), hostNumber(requireValue(a[11] ?? null, "src/vm/rv64.ts:1420"), "seek offset"), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1420"), "seek whence", 2)));
      case 63: {
        const fd = this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1422")), at = ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1422")), z = this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1422"), "read length", MAX_IO);
        const result = await this.events.read(fd, at, z);
        if (result !== null) return result;
        this.mem(at, z, true);
        const b = await this.read(fd, z);
        this.m.write(at, b);
        return BigInt(b.length);
      }
      case 64: {
        const fd = this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1431")), at = ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1431")), z = this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1431"), "write length", MAX_IO);
        const result = await this.events.write(fd, at, z);
        if (result !== null) return result;
        this.mem(at, z);
        return BigInt(await this.write(fd, this.m.read(at, z)));
      }
      case 65: return BigInt(await this.readv(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1437")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1437")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1437"), "iovec count", 1024)));
      case 66: return BigInt(await this.writev(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1438")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1438")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1438"), "iovec count", 1024)));
      case 67: return BigInt(this.pread(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1439")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1439")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1439"), "read length", MAX_IO), hostNumber(requireValue(a[13] ?? null, "src/vm/rv64.ts:1439"), "read offset")));
      case 68: return BigInt(this.pwrite(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1440")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1440")), this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1440"), "write length", MAX_IO), hostNumber(requireValue(a[13] ?? null, "src/vm/rv64.ts:1440"), "write offset")));
      case 73: return BigInt(this.ppoll(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1441")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1441"), "poll descriptor count", 1024)));
      case 78: { const b = enc(this.s.readlink(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1442"), this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1442"))))); return BigInt(this.copy(b, ux(requireValue(a[12] ?? null, "src/vm/rv64.ts:1442")), this.nat(requireValue(a[13] ?? null, "src/vm/rv64.ts:1442"), "readlink length", MAX_IO), true)); }
      case 79: { const p = this.str(requireValue(a[11] ?? null, "src/vm/rv64.ts:1443")), fl = this.nat(requireValue(a[13] ?? null, "src/vm/rv64.ts:1443"), "stat flags", 0xffff); return this.stat(this.path(requireValue(a[10] ?? null, "src/vm/rv64.ts:1443"), p), ux(requireValue(a[12] ?? null, "src/vm/rv64.ts:1443")), !(fl & 0x100)); }
      case 80: return this.fstat(this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1444")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1444")));
      case 81: case 82: case 83: return 0n;
      case 88: return this.utimens(requireValue(a[10] ?? null, "src/vm/rv64.ts:1446"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1446"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1446"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1446"));
      case 93:
        if (this.thistleThreads && this.thistleActiveHart !== 0) {
          this.thistleThreadExit(this.thistleActiveHart, Number(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1449")) & 255n));
          return 0n;
        }
        return this.vf ? this.vfExit(requireValue(a[10] ?? null, "src/vm/rv64.ts:1452")) : (this.exit(requireValue(a[10] ?? null, "src/vm/rv64.ts:1452")), 0n);
      case 94: return this.vf ? this.vfExit(requireValue(a[10] ?? null, "src/vm/rv64.ts:1453")) : (this.exit(requireValue(a[10] ?? null, "src/vm/rv64.ts:1453")), 0n);
      case 96: return this.thistleThreads
        ? this.thistleSetClearTid(requireValue(a[10] ?? null, "src/vm/rv64.ts:1455")) : BigInt(this.s.pid);
      case 98: return this.thistleThreads
        ? this.thistleFutex(requireValue(a[10] ?? null, "src/vm/rv64.ts:1457"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1457"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1457"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1457"))
        : this.futex(requireValue(a[10] ?? null, "src/vm/rv64.ts:1458"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1458"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1458"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1458"));
      case 99: return 0n;
      case 101: await this.sleepTs(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1460"))); return 0n;
      case 113: return this.clock(hostNumber(requireValue(a[10] ?? null, "src/vm/rv64.ts:1461"), "clock id"), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1461")));
      case 114: return this.clockRes(hostNumber(requireValue(a[10] ?? null, "src/vm/rv64.ts:1462"), "clock id"), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1462")));
      case 115: return this.clockSleep(requireValue(a[10] ?? null, "src/vm/rv64.ts:1463"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1463"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1463"));
      case 122: return this.setAffinity(requireValue(a[10] ?? null, "src/vm/rv64.ts:1464"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1464"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1464"));
      case 123: return this.getAffinity(requireValue(a[10] ?? null, "src/vm/rv64.ts:1465"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1465"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1465"));
      case 124: await this.s.yield(); return 0n;
      case 129: case 130: case 131: return BigInt(this.s.kill(hostNumber(n === 129 ? requireValue(a[10] ?? null, "src/vm/rv64.ts:1467") : requireValue(a[11] ?? null, "src/vm/rv64.ts:1467"), "pid"), this.nat(n === 129 ? requireValue(a[11] ?? null, "src/vm/rv64.ts:1467") : requireValue(a[12] ?? null, "src/vm/rv64.ts:1467"), "signal", 64) as 0 | 1 | 2 | 9 | 13 | 15));
      case 132: case 134: case 135: return 0n;
      case 160: return this.uname(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1469")));
      case 153: return this.times(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1470")));
      case 163: return this.limit(0n, requireValue(a[10] ?? null, "src/vm/rv64.ts:1471"), 0n, requireValue(a[11] ?? null, "src/vm/rv64.ts:1471"));
      case 164: return this.limit(0n, requireValue(a[10] ?? null, "src/vm/rv64.ts:1472"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1472"), 0n);
      case 165: return this.usage(requireValue(a[10] ?? null, "src/vm/rv64.ts:1473"), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1473")));
      case 166: { const old = this.s.umask; this.s.umask = this.nat(requireValue(a[10] ?? null, "src/vm/rv64.ts:1474"), "umask", 0o777); return BigInt(old); }
      case 168: return this.getcpu(requireValue(a[10] ?? null, "src/vm/rv64.ts:1475"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1475"));
      case 169: return this.timeval(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1476")));
      case 143: this.s.setRegid(this.idOrKeep(requireValue(a[10] ?? null, "src/vm/rv64.ts:1477")), this.idOrKeep(requireValue(a[11] ?? null, "src/vm/rv64.ts:1477"))); return 0n;
      case 144: this.s.setGid(this.owner(requireValue(a[10] ?? null, "src/vm/rv64.ts:1478"), "gid")); return 0n;
      case 145: this.s.setReuid(this.idOrKeep(requireValue(a[10] ?? null, "src/vm/rv64.ts:1479")), this.idOrKeep(requireValue(a[11] ?? null, "src/vm/rv64.ts:1479"))); return 0n;
      case 146: this.s.setUid(this.owner(requireValue(a[10] ?? null, "src/vm/rv64.ts:1480"), "uid")); return 0n;
      case 147: this.s.setResuid(this.idOrKeep(requireValue(a[10] ?? null, "src/vm/rv64.ts:1481")), this.idOrKeep(requireValue(a[11] ?? null, "src/vm/rv64.ts:1481")), this.idOrKeep(requireValue(a[12] ?? null, "src/vm/rv64.ts:1481"))); return 0n;
      case 148: return this.getres(this.addrPtr(requireValue(a[10] ?? null, "src/vm/rv64.ts:1482")), this.addrPtr(requireValue(a[11] ?? null, "src/vm/rv64.ts:1482")), this.addrPtr(requireValue(a[12] ?? null, "src/vm/rv64.ts:1482")), false);
      case 149: this.s.setResgid(this.idOrKeep(requireValue(a[10] ?? null, "src/vm/rv64.ts:1483")), this.idOrKeep(requireValue(a[11] ?? null, "src/vm/rv64.ts:1483")), this.idOrKeep(requireValue(a[12] ?? null, "src/vm/rv64.ts:1483"))); return 0n;
      case 150: return this.getres(this.addrPtr(requireValue(a[10] ?? null, "src/vm/rv64.ts:1484")), this.addrPtr(requireValue(a[11] ?? null, "src/vm/rv64.ts:1484")), this.addrPtr(requireValue(a[12] ?? null, "src/vm/rv64.ts:1484")), true);
      case 151: return BigInt(this.s.setFsuid(this.owner(requireValue(a[10] ?? null, "src/vm/rv64.ts:1485"), "uid")));
      case 152: return BigInt(this.s.setFsgid(this.owner(requireValue(a[10] ?? null, "src/vm/rv64.ts:1486"), "gid")));
      case 158: return BigInt(this.getgroups(requireValue(a[10] ?? null, "src/vm/rv64.ts:1487"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1487")));
      case 159: this.setgroups(requireValue(a[10] ?? null, "src/vm/rv64.ts:1488"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1488")); return 0n;
      case 172: return BigInt(this.s.pid);
      case 173: return BigInt(this.s.ppid);
      case 174: return BigInt(this.s.uid);
      case 175: return BigInt(this.s.euid);
      case 176: return BigInt(this.s.gid);
      case 177: return BigInt(this.s.egid);
      case 178: return BigInt(withValue(this.thistleThreads, value => value.tids.get(this.thistleActiveHart) ?? null) ?? this.s.pid);
      case 179: return this.sysinfo(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1496")));
      case 198: return BigInt(this.socket(
        this.nat(requireValue(a[10] ?? null, "src/vm/rv64.ts:1498"), "socket domain", 0x7fffffff),
        this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1499"), "socket type", 0xffffffff),
        this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1500"), "socket protocol", 0x7fffffff),
      ));
      case 203: return this.connect(
        this.fd(requireValue(a[10] ?? null, "src/vm/rv64.ts:1503")),
        ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1504")),
        this.nat(requireValue(a[12] ?? null, "src/vm/rv64.ts:1505"), "socket address length", 4096),
      );
      case 215: this.unmap(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1508")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1508"), "mapping length", Number.MAX_SAFE_INTEGER)); return 0n;
      case 216: return this.remap(requireValue(a[10] ?? null, "mremap address"), requireValue(a[11] ?? null, "mremap old length"), requireValue(a[12] ?? null, "mremap new length"));
      case 220: return this.thistleThreads
        ? this.thistleCloneThread(requireValue(a[10] ?? null, "src/vm/rv64.ts:1511"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1511"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1511"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1511"), requireValue(a[14] ?? null, "src/vm/rv64.ts:1511"))
        : this.clone(requireValue(a[10] ?? null, "src/vm/rv64.ts:1512"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1512"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1512"));
      case 221: return this.execve(this.str(requireValue(a[10] ?? null, "src/vm/rv64.ts:1513")), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1513")), ux(requireValue(a[12] ?? null, "src/vm/rv64.ts:1513")));
      case 222: return this.mmap(requireValue(a[10] ?? null, "src/vm/rv64.ts:1514"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1514"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1514"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1514"), requireValue(a[14] ?? null, "src/vm/rv64.ts:1514"), requireValue(a[15] ?? null, "src/vm/rv64.ts:1514"));
      case 227: this.flushShared(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1515")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1515"), "sync length", Number.MAX_SAFE_INTEGER)); return 0n;
      case 226: return 0n;
      case 233: return 0n;
      case 261: return this.limit(requireValue(a[10] ?? null, "src/vm/rv64.ts:1518"), requireValue(a[11] ?? null, "src/vm/rv64.ts:1518"), requireValue(a[12] ?? null, "src/vm/rv64.ts:1518"), requireValue(a[13] ?? null, "src/vm/rv64.ts:1518"));
      case 278: return BigInt(this.random(ux(requireValue(a[10] ?? null, "src/vm/rv64.ts:1519")), this.nat(requireValue(a[11] ?? null, "src/vm/rv64.ts:1519"), "random length", MAX_IO)));
      case 260: return this.wait4(requireValue(a[10] ?? null, "src/vm/rv64.ts:1520"), ux(requireValue(a[11] ?? null, "src/vm/rv64.ts:1520")), requireValue(a[12] ?? null, "src/vm/rv64.ts:1520"), ux(requireValue(a[13] ?? null, "src/vm/rv64.ts:1520")));
      default: if (!this.miss.has(n)) { this.miss.add(n); this.s.k.log(`rv64: unsupported syscall ${n}`); } return -38n;
    }
  }

  private async read(fd: number, n: number): Promise<Uint8Array> {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
    const input = f.input;
    if (input === null && f.inode !== 0 && n !== 0) await f.materialiseFile();
    if (input === null) return f.inode === 0 ? this.s.fdr(fd, n) : f.readFile(n);
    let q = (this.ins.get(fd) ?? null);
    if (!q || q.at >= q.b.length) { q = { b: await input.rd(this.s.p.ac.signal), at: 0 }; this.ins.set(fd, q); }
    const b = q.b.slice(q.at, q.at + n); q.at += b.length; return b;
  }

  private async write(fd: number, b: Uint8Array): Promise<number> {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
    if (f.output !== null) return f.output.wr(b);
    if (f.inode === 0) return this.s.fdw(fd, b);
    if (b.length !== 0) await f.materialiseFile();
    return f.writeFile(b);
  }

  private clone(flags: bigint, sp: bigint, tls: bigint): bigint {
    if (this.vf) bad("EAGAIN", "nested RV64 clone");
    const par = this.copyFds(this.s.p.fds.entries()), kid = this.copyFds(this.s.p.fds.entries(), true);
    this.vf = { x: this.x.slice(), f: this.f.slice(), pc: this.pc, cwd: this.s.p.cwd, env: new Map(this.s.p.env), fds: par };
    this.s.p.fds.clear(); for (const [n, q] of kid) this.s.p.fds.set(n, q);
    if (sp) this.x[2] = sx(sp, 64);
    if (ux(flags) & 0x80000n) this.x[4] = sx(tls, 64);
    return 0n;
  }

  private async execve(path: string, av: bigint, ev: bigint): Promise<bigint> {
    // Ordinary exec replaces this process; a vfork child instead starts the new image and restores the suspended parent.
    const argv = this.vec(av), env = new Map<string, string>();

    for (const q of this.vec(ev)) {
      const n = q.indexOf("=");

      if (n > 0) {
        env.set(q.slice(0, n), q.slice(n + 1));
      }
    }

    if (!this.vf) {
      this.flushAllShared();
      await this.s.exec(path, argv.length ? argv : [path], env);
    }

    const io: StartIo = { sin: null, sout: null, serr: null }, f0 = (this.s.p.fds.get(0) ?? null), f1 = (this.s.p.fds.get(1) ?? null), f2 = (this.s.p.fds.get(2) ?? null);
    if (f0 && f0.input) io.sin = f0.input;
    if (f1 && f1.output) io.sout = f1.output;
    if (f2 && f2.output) io.serr = f2.output;
    const cwd = this.s.p.cwd, kid = this.s.p.fds.values();
    const pass = new Map(this.s.p.fds.entries().filter(([, f]) => !f.clo));
    const p = this.s.start(path, (argv.length ? argv : [path]).slice(1), {"pgid": null,  io, fds: pass, cwd, env });
    this.restoreVf();
    this.dropFds(kid);
    return BigInt(p.pid);
  }

  private vfExit(code: bigint): bigint {
    const kid = this.s.p.fds.values(), n = Number(ux(code) & 255n);
    const p = this.s.start("thsh", ["-c", `exit ${n}`], {"io": null, "fds": null, "pgid": null,  cwd: this.s.p.cwd, env: new Map(this.s.p.env) });
    this.restoreVf();
    this.dropFds(kid);
    return BigInt(p.pid);
  }

  private async wait4(pid0: bigint, st: bigint, fl0: bigint, ru: bigint): Promise<bigint> {
    const pid = hostNumber(pid0, "wait pid"), fl = this.nat(fl0, "wait flags", 0x7fffffff);
    const p = (pid > 0 ? (this.s.k.procs.get(pid) ?? null) : ([...this.s.p.kids].map(n => (this.s.k.procs.get(n) ?? null)).find(q => q !== null) ?? null)) ?? bad("ECHILD", String(pid));
    if (p.ppid !== this.s.pid) bad("ECHILD", String(pid));
    if ((fl & 1) && !p.completed) return 0n;
    const code = await p.done, sig = p.sig;
    if (st) { this.mem(st, 4, true); this.m.set32(st, sig ? sig & 0x7f : (code & 255) << 8); }
    if (ru) this.putUsage(ru, p.ms());
    this.s.reap(p.pid); return BigInt(p.pid);
  }

  private restoreVf(): void {
    const q = this.vf ?? bad("EPROTO", "missing RV64 parent context");
    this.x.set(q.x); this.f.set(q.f); this.pc = q.pc;
    this.s.p.cwd = q.cwd; this.s.p.env = new Map(q.env);
    this.s.p.fds.clear(); for (const [n, f] of q.fds) this.s.p.fds.set(n, f);
    this.vf = null;
  }

  private copyFds(src: Array<[number, Fd]>, hold = false): Map<number, Fd> {
    const out = new Map<number, Fd>();
    for (const [n, f] of src) {
      if (hold) { withValue(withValue(f.input ?? null, value => value.holdR) ?? null, callable => callable.call(f.input)); withValue(withValue(f.output ?? null, value => value.hold) ?? null, callable => callable.call(f.output)); }
      const q = new Fd(f.input, f.output, f.path, { rd: f.rd, wr: f.wr, add: f.add, clo: f.clo }); q.pos = f.pos; out.set(n, q);
    }
    return out;
  }

  private dropFds(a: Fd[]): void { for (const f of a) { withValue(withValue(f.input ?? null, value => value.releaseR) ?? null, callable => callable.call(f.input)); withValue(withValue(f.output ?? null, value => value.close) ?? null, callable => callable.call(f.output)); } }

  private vec(at0: bigint): string[] {
    if (!at0) return [];
    const out: string[] = [], at = ux(at0);
    for (let i = 0; i < 4096; i++) { this.mem(at + BigInt(i * 8), 8); const p = this.m.u64(at + BigInt(i * 8)); if (!p) return out; out.push(this.str(p)); }
    return bad("EFBIG", "RV64 argument vector");
  }

  private async openat(fd0: bigint, p: string, fl: number, mode: number): Promise<number> {
    const path = this.path(fd0, p);
    const ac = fl & 3;
    if (ac === 3) bad("EINVAL", "invalid open access mode");

    let made = false;
    try {
      const st = this.s.stat(path);

      /*
       * Linux permits a directory to be opened read-only without requiring
       * O_DIRECTORY. Native software commonly does this to obtain a stable
       * directory descriptor for openat(), fstat() and getdents().
       */
      if (st.kind === "dir") {
        ensure(!(ac !== 0 || fl & (O_CREAT | O_TRUNC)), () => bad("EISDIR", path));

        const n = this.s.openDir(path);
        requireValue(this.s.p.fds.get(n) ?? null, "src/vm/rv64.ts:1639").clo = !!(fl & O_CLOEXEC);
        return n;
      }

      if (fl & O_DIRECTORY) bad("ENOTDIR", path);
      if (fl & O_CREAT && fl & O_EXCL) bad("EEXIST", path);
      await this.s.materialise(path);
    } catch (caughtValue) { const e = caughtValue instanceof Error ? caughtValue : new Error(typeof caughtValue === "undefined" ? "undefined" : String(caughtValue));
      if (!(e instanceof KErr) || e.code !== "ENOENT" || !(fl & O_CREAT)) {
        throw e;
      }

      if (fl & O_DIRECTORY) throw e;

      this.s.mkfile(path, new Uint8Array(), mode || 0o666);
      made = true;
    }

    const plus = ac === O_RDWR;
    const wr = ac === O_WRONLY || plus;

    if (!made && fl & O_TRUNC && wr) {
      this.s.writeb(path, new Uint8Array());
    }

    const kind = fl & O_APPEND
      ? plus ? "a+" : "a"
      : plus
        ? fl & O_TRUNC ? "w+" : "r+"
        : wr
          ? fl & O_TRUNC ? "w" : "ow"
          : "r";

    const n = this.s.open(path, kind, mode || 0o666);
    requireValue(this.s.p.fds.get(n) ?? null, "src/vm/rv64.ts:1673").clo = !!(fl & O_CLOEXEC);
    return n;
  }

  private socket(
    domain: number,
    type: number,
    protocol: number,
  ): number {
    // Only local stream sockets are supported; reject unsupported protocols, types and flags before allocating a descriptor.
    if (domain !== AF_UNIX) return -97;
    if (protocol !== 0) return -93;

    const kind = type & SOCK_TYPE_MASK;
    const flags = type & ~SOCK_TYPE_MASK;

    if (kind !== SOCK_STREAM) return -94;
    if (flags & ~SOCK_CLOEXEC) return -22;

    const fd = this.s.k.fd(this.s.p);

    this.s.p.fds.set(
      fd,
      new Fd(null, null, null, { rd: true, wr: true, add: false, clo: !!(flags & SOCK_CLOEXEC) }),
    );

    this.localSockets.add(fd);
    return fd;
  }

  private connect(
    fd: number,
    at: bigint,
    length: number,
  ): bigint {
    if (!this.s.p.fds.has(fd)) return -9n;
    if (!this.localSockets.has(fd)) return -88n;
    if (length < 2) return -22n;
    if (at === 0n) return -14n;

    this.mem(at, length);

    if (this.m.u16(at) !== AF_UNIX) {
      return -97n;
    }

    const name = this.m.read(
      at + 2n,
      length - 2,
    );

    /*
     * There is not yet an AF_UNIX namespace in mikuOS. A pathname
     * socket therefore behaves like an absent socket node.
     *
     * This lets musl probe /var/run/nscd/socket and then fall back to
     * the local passwd and group databases.
     */
    if (name.length === 0 || (name[0] ?? null) === 0) {
      return -111n;
    }

    return -2n;
  }

  private dup3(old0: bigint, nu0: bigint, fl0: bigint): number {
    const old = this.fd(old0), nu = this.fd(nu0), fl = this.nat(fl0, "dup flags", 0xffffffff);
    if (old === nu || fl & ~O_CLOEXEC) bad("EINVAL", "invalid dup3 arguments");
    const n = this.s.dup(old, nu);
    requireValue(this.s.p.fds.get(n) ?? null, "src/vm/rv64.ts:1749").clo = !!(fl & O_CLOEXEC);
    if (this.localSockets.has(old)) this.localSockets.add(n);
    this.events.duplicate(old, n);
    return n;
  }

  private path(fd0: bigint, p: string): string {
    if (p.startsWith("/")) return norm(p);
    const fd = hostNumber(fd0, "directory descriptor");
    if (fd === AT_FDCWD) return norm(p, this.s.cwd);
    const base = this.s.fdPath(fd);
    if (this.s.fdStat(fd).kind !== "dir") bad("ENOTDIR", base);
    return base === "/" ? "/" + p : base + "/" + p;
  }

  private fcntl(fd: number, cmd: number, arg: bigint): number {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
    if (cmd === 0 || cmd === 1030) {
      const min = this.nat(arg, "descriptor minimum", 255);
      const q = this.s.dup(fd, this.s.p.fds.next(Math.max(3, min)));
      requireValue(this.s.p.fds.get(q) ?? null, "src/vm/rv64.ts:1770").clo = cmd === 1030;
      (this.localSockets.has(fd)) && (this.localSockets.add(q));
      this.events.duplicate(fd, q);
      return q;
    }
    if (cmd === 1) return f.clo ? 1 : 0;
    if (cmd === 2) { f.clo = !!(this.nat(arg, "descriptor flags", 0x7fffffff) & 1); return 0; }
    if (cmd === 3) return this.events.flags(fd) ?? (f.rd && f.wr ? O_RDWR : f.wr ? O_WRONLY : 0);
    if (cmd === 4) {
      const flags = this.nat(arg, "descriptor flags", 0x7fffffff);
      (!this.events.setStatusFlags(fd, flags)) && (f.add = !!(flags & O_APPEND));
      return 0;
    }
    return -22;
  }

  // Guest state updates stay inside the selected instruction or syscall path.
  //@cg-expect-warning
  private ioctl(
    fd: number,
    req: number,
    at: bigint,
  ): bigint {
    const descriptor =
      this.s.p.fds.get(fd) ??
      bad("EBADF", String(fd));

    const tty = terminalFromFd(descriptor);

    if (!tty) {
      return -25n;
    }

    if (req === TCGETS) {
      const raw = tty.termios();

      // Guest state updates stay inside the selected instruction or syscall path.
      //@cg-expect-warning
      if (raw.byteLength < LINUX_TERMIOS_SIZE) {
        return -22n;
      }

      this.mem(
        at,
        LINUX_TERMIOS_SIZE,
        true,
      );

      this.m.write(
        at,
        raw.subarray(
          0,
          LINUX_TERMIOS_SIZE,
        ),
      );

      return 0n;
    }

    if (
      req === TCSETS ||
      req === TCSETSW ||
      req === TCSETSF
    ) {
      this.mem(
        at,
        LINUX_TERMIOS_SIZE,
      );

      tty.setTermios(
        this.m.read(
          at,
          LINUX_TERMIOS_SIZE,
        ),
        req === TCSETSF,
      );

      return 0n;
    }

    if (req === TIOCGWINSZ) {
      const size = tty.size();

      this.mem(
        at,
        LINUX_WINSIZE_SIZE,
        true,
      );

      this.m.set16(
        at,
        Math.min(
          0xffff,
          Math.max(0, size.rows),
        ),
      );

      this.m.set16(
        at + 2n,
        Math.min(
          0xffff,
          Math.max(0, size.cols),
        ),
      );

      this.m.set16(at + 4n, 0);
      this.m.set16(at + 6n, 0);

      return 0n;
    }

    if (req === TIOCSWINSZ) {
      this.mem(
        at,
        LINUX_WINSIZE_SIZE,
      );

      tty.resize(
        this.m.u16(at),
        this.m.u16(at + 2n),
      );

      return 0n;
    }

    return -25n;
  }

  private getdents(fd: number, at: bigint, n: number): number {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
    const a = this.s.fdList(fd), out = new Uint8Array(n), v = new DataView(out.buffer); let pos = 0;
    while (f.pos < a.length) {
      const [name, q] = requireValue(a[f.pos] ?? null, "src/vm/rv64.ts:1900"), b = enc(name + "\0"), z = (19 + b.length + 7) & -8;
      if (pos + z > n) { ensure(pos, () => bad("EINVAL", "directory buffer is too small")); break; }
      v.setBigUint64(pos, BigInt(q.ino), true); v.setBigUint64(pos + 8, BigInt(f.pos + 1), true); v.setUint16(pos + 16, z, true);
      out[pos + 18] = q.kind === "dir" ? 4 : q.kind === "file" ? 8 : q.kind === "link" ? 10 : 2; out.set(b, pos + 19);
      pos += z; f.pos++;
    }
    this.mem(at, pos, true); this.m.write(at, out.subarray(0, pos)); return pos;
  }

  private pread(fd: number, at: bigint, n: number, off: number): number {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd)), old = f.pos; f.pos = off;
    try { const b = this.s.fdr(fd, n); this.mem(at, b.length, true); this.m.write(at, b); return b.length; }
    finally { f.pos = old; }
  }

  private pwrite(fd: number, at: bigint, n: number, off: number): number {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd)), old = f.pos; f.pos = off;
    try { this.mem(at, n); return this.s.fdw(fd, this.m.read(at, n)); }
    finally { f.pos = old; }
  }

  private ppoll(at: bigint, n: number): number {
    if (!n) return 0;
    this.mem(at, n * 8, true);
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const p = at + BigInt(i * 8), fd = Number(this.m.i32(p));
      let revents = 0;
      switch (true) {
case !!(fd >= 0 && !this.s.p.fds.has(fd)): {
        revents = 0x20; // POLLNVAL

break; }
case !!(fd >= 0): {
        revents = this.events.readiness(fd, this.m.u16(p + 4n)) ?? 0;

break; }
}
      if (revents !== 0) hit++;
      this.m.set16(p + 6n, revents);
    }
    return hit;
  }

  private stat(p: string, at: bigint, follow = true): bigint { this.putStat(this.s.stat(p, follow), at); return 0n; }

  private fstat(fd: number, at: bigint): bigint {
    const f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
    if (this.events.has(fd)) {
      this.putStat({
        ino: fd + 1, kind: "char", mode: 0o600,
        uid: this.s.uid, gid: this.s.gid, nlink: 1, size: 0,
        at: Date.now(), mt: Date.now(), ct: Date.now(),
      }, at);
      return 0n;
    }
    if (f.inode !== 0) { this.putStat(this.s.fdStat(fd), at); return 0n; }
    if (fd < 3) this.putStat({ ino: fd + 1, kind: "char", mode: 0o620, uid: this.s.uid, gid: this.s.gid, nlink: 1, size: 0, at: Date.now(), mt: Date.now(), ct: Date.now() }, at);
    else this.putStat(this.s.fdStat(fd), at);
    return 0n;
  }

  private addrPtr(n: bigint): bigint {
    if (!n) bad("EFAULT", "null pointer");
    return ux(n);
  }

  private getres(a: bigint, b: bigint, c: bigint, group: boolean): bigint {
    this.mem(a, 4, true); this.mem(b, 4, true); this.mem(c, 4, true);
    if (group) {
      this.m.set32(a, this.s.rgid); this.m.set32(b, this.s.egid); this.m.set32(c, this.s.sgid);
    } else {
      this.m.set32(a, this.s.ruid); this.m.set32(b, this.s.euid); this.m.set32(c, this.s.suid);
    }
    return 0n;
  }

  private getgroups(n0: bigint, at0: bigint): number {
    const n = this.nat(n0, "group count", 65536), groups = this.s.groups;
    if (n === 0) return groups.length;
    if (n < groups.length) bad("EINVAL", "group buffer too small");
    const at = this.addrPtr(at0);
    this.mem(at, groups.length * 4, true);
    groups.forEach((g, i) => this.m.set32(at + BigInt(i * 4), g));
    return groups.length;
  }

  private setgroups(n0: bigint, at0: bigint): void {
    const n = this.nat(n0, "group count", 65536), at = n ? this.addrPtr(at0) : 0n;
    if (n) this.mem(at, n * 4);
    const groups: number[] = [];
    for (let i = 0; i < n; i++) groups.push(this.m.u32(at + BigInt(i * 4)));
    this.s.setGroups(groups);
  }

  private putStat(q: { ino: number; kind: "file" | "dir" | "link" | "char"; mode: number; uid: number; gid: number; nlink: number; size: number; at: number; mt: number; ct: number }, at: bigint): void {
    this.mem(at, 128, true);
    const typ = q.kind === "file" ? 0o100000 : q.kind === "dir" ? 0o040000 : q.kind === "link" ? 0o120000 : 0o020000;
    this.m.set64(at, 1); this.m.set64(at + 8n, q.ino); this.m.set32(at + 16n, typ | q.mode); this.m.set32(at + 20n, q.nlink);
    this.m.set32(at + 24n, q.uid); this.m.set32(at + 28n, q.gid); this.m.set64(at + 32n, q.kind === "char" ? 1 : 0); this.m.set64(at + 40n, 0);
    this.m.set64(at + 48n, q.size); this.m.set32(at + 56n, 4096); this.m.set32(at + 60n, 0); this.m.set64(at + 64n, Math.ceil(q.size / 512));
    this.putTs(at + 72n, q.at); this.putTs(at + 88n, q.mt); this.putTs(at + 104n, q.ct); this.m.set64(at + 120n, 0);
  }

  private putTs(at: bigint, ms: number): void { this.m.set64(at, Math.floor(ms / 1000)); this.m.set64(at + 8n, Math.floor(ms % 1000) * 1_000_000); }

  private statfs(at: bigint): bigint {
    const bs = 4096, cap = this.s.k.fs.cap, used = this.s.k.fs.used();
    const blocks = Math.floor(cap / bs), hit = Math.ceil(used / bs), files = Math.max(1024, blocks * 4);
    this.mem(at, 120, true); this.m.write(at, new Uint8Array(120));
    this.m.set64(at, 0x54484953); this.m.set64(at + 8n, bs);
    this.m.set64(at + 16n, blocks); this.m.set64(at + 24n, Math.max(0, blocks - hit)); this.m.set64(at + 32n, Math.max(0, blocks - hit));
    this.m.set64(at + 40n, files); this.m.set64(at + 48n, Math.max(0, files - this.s.k.fs.root.ent.size));
    this.m.set32(at + 56n, 0x5448); this.m.set32(at + 60n, 0x4953);
    this.m.set64(at + 64n, 255); this.m.set64(at + 72n, bs); this.m.set64(at + 80n, 0);
    return 0n;
  }

  private utimens(fd0: bigint, p0: bigint, ts0: bigint, fl0: bigint): bigint {
    // Empty-path flags select an existing descriptor; no-follow and UTIME_OMIT must preserve the selected inode and timestamps.
    const fl = this.nat(fl0, "utimensat flags", 0x7fffffff);
    if (fl & ~0x1100) bad("EINVAL", "unsupported utimensat flags");
    let p: string;
    if (!p0) {
      const fd = this.fd(fd0), f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
      p = f.path ?? bad("EBADF", String(fd));
    } else {
      const raw = this.str(p0);
      switch (true) {
case !!(!raw && fl & 0x1000): {
        const fd = this.fd(fd0), f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
        p = f.path ?? bad("EBADF", String(fd));

break; }
case !!(!raw): { return bad("ENOENT", "empty utimensat path"); }
default: { p = this.path(fd0, raw); }
}
    }
    const follow = !(fl & 0x100), q = this.s.stat(p, follow), now = Date.now();
    let at = now, mt = now;
    if (ts0) {
      const ts = ux(ts0); this.mem(ts, 32);
      at = this.fileTs(ts, q.at, now); mt = this.fileTs(ts + 16n, q.mt, now);
    }
    this.s.utime(p, at, mt, follow); return 0n;
  }

  private fileTs(at: bigint, old: number, now: number): number {
    const ns = this.m.i64(at + 8n);
    if (ns === 0x3ffffffen) return old;
    if (ns === 0x3fffffffn) return now;
    if (ns < 0n || ns >= 1_000_000_000n) bad("EINVAL", "invalid file timestamp");
    return hostNumber(this.m.i64(at), "timestamp seconds") * 1000 + Number(ns / 1_000_000n);
  }

  private async futex(at0: bigint, op0: bigint, val0: bigint, to0: bigint): Promise<bigint> {
    const at = ux(at0), op = this.nat(op0, "futex operation", 0x7fffffff) & 0x7f;
    this.mem(at, 4, op === 1 || op === 10);
    if (op === 1 || op === 10 || op === 3 || op === 4) return 0n;
    if (op !== 0 && op !== 9) return -38n;
    if (op === 9 && !ux(requireValue(this.x[15] ?? null, "src/vm/rv64.ts:2049"))) bad("EINVAL", "empty futex bitset");
    if (this.m.u32(at) !== Number(ux(val0) & 0xffffffffn)) return -11n;
    if (!to0) { await this.s.yield(); return 0n; } // A lone task may wake spuriously; POSIX permits that dance.
    const to = ux(to0), ms = this.readTs(to);
    const wait = op === 9 ? ms - this.clockMs(op0 & 0x100n ? 0 : 1) : ms;
    if (wait > 0) await this.s.sleep(Math.min(wait, 0x7fffffff));
    return -110n;
  }

  private clockMs(id: number | bigint): number {
    const n = Number(id);
    if (n === 0 || n === 5 || n === 11) return Date.now();
    if (n === 1 || n === 4 || n === 6 || n === 7) return this.s.uptime();
    if (n === 2 || n === 3) return this.s.p.ms();
    return bad("EINVAL", `unsupported clock ${n}`);
  }

  private clock(id: number, at: bigint): bigint { this.mem(at, 16, true); this.putTs(at, this.clockMs(id)); return 0n; }

  private clockRes(id: number, at: bigint): bigint {
    this.clockMs(id);
    if (at) { this.mem(at, 16, true); this.m.set64(at, 0); this.m.set64(at + 8n, 1_000_000); }
    return 0n;
  }

  private readTs(at: bigint): number {
    this.mem(at, 16); const sec = hostNumber(this.m.i64(at), "timespec seconds"), ns = this.m.i64(at + 8n);
    if (sec < 0 || ns < 0n || ns >= 1_000_000_000n) bad("EINVAL", "invalid timespec");
    const ms = sec * 1000 + Number(ns) / 1e6;
    if (!Number.isSafeInteger(Math.floor(ms))) bad("ERANGE", "timespec is too large");
    return ms;
  }

  private async sleepTs(at: bigint): Promise<void> { const ms = this.readTs(at); if (ms) await this.s.sleep(Math.min(ms, 0x7fffffff)); }

  private async clockSleep(id0: bigint, fl0: bigint, at0: bigint): Promise<bigint> {
    const id = hostNumber(id0, "clock id"), fl = this.nat(fl0, "clock sleep flags", 1);
    const ms = this.readTs(ux(at0)), wait = fl ? ms - this.clockMs(id) : ms;
    if (wait > 0) await this.s.sleep(Math.min(wait, 0x7fffffff));
    return 0n;
  }

  private setAffinity(pid0: bigint, z0: bigint, at0: bigint): bigint {
    const pid = hostNumber(pid0, "affinity pid"), z = this.nat(z0, "affinity size", MAX_IO), at = ux(at0);
    if (pid && pid !== this.s.pid) bad("ESRCH", String(pid));
    if (!z) bad("EINVAL", "empty CPU set");
    this.mem(at, z); if (!(this.m.u8(at) & 1)) bad("EINVAL", "Thistle has one schedulable CPU");
    return 0n;
  }

  private getAffinity(pid0: bigint, z0: bigint, at0: bigint): bigint {
    const pid = hostNumber(pid0, "affinity pid"), z = this.nat(z0, "affinity size", MAX_IO), at = ux(at0);
    if (pid && pid !== this.s.pid) bad("ESRCH", String(pid));
    if (z < 8) bad("EINVAL", "CPU set is shorter than one kernel word");
    this.mem(at, z, true); this.m.write(at, new Uint8Array(z)); this.m.set8(at, 1); return 8n;
  }

  private times(at: bigint): bigint {
    const hz = 100, self = Math.floor(this.s.p.ms() * hz / 1000);
    if (at) {
      this.mem(at, 32, true); this.m.write(at, new Uint8Array(32)); this.m.set64(at, self);
    }
    return BigInt(Math.floor(this.s.uptime() * hz / 1000));
  }

  private usage(who0: bigint, at: bigint): bigint {
    const who = hostNumber(who0, "rusage target");
    if (who !== -1 && who !== 0 && who !== 1) bad("EINVAL", String(who));
    this.putUsage(at, who === -1 ? 0 : this.s.p.ms()); return 0n;
  }

  private putUsage(at: bigint, ms: number): void {
    this.mem(at, 144, true); this.m.write(at, new Uint8Array(144));
    this.m.set64(at, Math.floor(ms / 1000)); this.m.set64(at + 8n, Math.floor(ms % 1000) * 1000);
    this.m.set64(at + 32n, Math.ceil(this.m.used / 1024)); this.m.set64(at + 64n, this.m.used / 65536);
  }

  private getcpu(cpu0: bigint, node0: bigint): bigint {
    if (cpu0) { const at = ux(cpu0); this.mem(at, 4, true); this.m.set32(at, 0); }
    if (node0) { const at = ux(node0); this.mem(at, 4, true); this.m.set32(at, 0); }
    return 0n;
  }

  private sysinfo(at: bigint): bigint {
    const mem = this.s.k.lim.mem, free = Math.max(0, mem - this.m.used), run = [...this.s.k.procs.values()].filter(p => p.state === "run").length;
    this.mem(at, 112, true); this.m.write(at, new Uint8Array(112));
    this.m.set64(at, Math.floor(this.s.uptime() / 1000));
    this.m.set64(at + 8n, run * 65536); this.m.set64(at + 16n, run * 32768); this.m.set64(at + 24n, run * 16384);
    this.m.set64(at + 32n, mem); this.m.set64(at + 40n, free);
    this.m.set16(at + 80n, Math.min(0xffff, this.s.k.procs.size)); this.m.set32(at + 104n, 1);
    return 0n;
  }

  private timeval(at: bigint): bigint { if (at) { this.mem(at, 16, true); const n = Date.now(); this.m.set64(at, Math.floor(n / 1000)); this.m.set64(at + 8n, Math.floor(n % 1000) * 1000); } return 0n; }

  private uname(at: bigint): bigint {
    this.mem(at, 390, true); const a = [this.s.k.name, this.s.k.host, this.s.k.release, "Thistle64 RV64GC", "riscv64", "localdomain"];
    a.forEach((x, i) => { const b = enc(x + "\0").slice(0, 65); this.m.write(at + BigInt(i * 65), b); }); return 0n;
  }

  private limit(pid0: bigint, res0: bigint, nu0: bigint, old0: bigint): bigint {
    const pid = hostNumber(pid0, "limit pid"), res = this.nat(res0, "limit resource", 15);
    if (pid && pid !== this.s.pid) bad("ESRCH", String(pid));
    const old = this.getLimit(res);
    if (old0) { const at = ux(old0); this.mem(at, 16, true); this.m.set64(at, old[0]); this.m.set64(at + 8n, old[1]); }
    if (nu0) {
      const at = ux(nu0); this.mem(at, 16); const cur = this.m.u64(at), max = this.m.u64(at + 8n);
      ensure(!(max !== MASK && cur > max), () => bad("EINVAL", "soft limit exceeds hard limit"));
      ensure(!(this.s.uid && old[1] !== MASK && (max === MASK || max > old[1])), () => bad("EPERM", "hard limit increase"));
      this.rlim.set(res, [cur, max]);
    }
    return 0n;
  }

  private getLimit(res: number): [bigint, bigint] {
    const hit = (this.rlim.get(res) ?? null); if (hit) return hit;
    const mem = BigInt(this.s.k.lim.mem), fs = BigInt(this.s.k.fs.cap), stack = BigInt(this.s.k.lim.stack);
    let q: [bigint, bigint];
    switch (true) {
case !!(res === 1): { q = [fs, fs];
break; }
case !!(res === 2 || res === 5 || res === 8 || res === 9 || res === 12): { q = [mem, mem];
break; }
case !!(res === 3): { q = [stack, mem];
break; }
case !!(res === 4 || res === 13 || res === 14): { q = [0n, 0n];
break; }
case !!(res === 6): { q = [1024n, 1024n];
break; }
case !!(res === 7): { q = [256n, 256n];
break; }
case !!(res === 11): { q = [256n, 256n];
break; }
default: { q = [MASK, MASK]; }
}
    this.rlim.set(res, q); return q;
  }

  private copy(b: Uint8Array, at: bigint, n: number, cut = false): number {
    const q = cut ? b.slice(0, n) : b;
    if (q.length > n) bad("ERANGE", "RV64 output buffer is too small");
    this.mem(at, q.length, true); this.m.write(at, q); return q.length;
  }

  private trunc(p: string, z: number): void { const b = this.s.readb(p), q = new Uint8Array(z); q.set(b.subarray(0, z)); this.s.writeb(p, q); }

  private str(at0: bigint): string { return readString(this.m, this.mem.bind(this), at0, "RV64 string"); }

  private async readv(fd: number, at: bigint, n: number): Promise<number> {
    this.mem(at, n * 16); let done = 0;
    for (let i = 0; i < n; i++) {
      const p = this.m.u64(at + BigInt(i * 16)), z = this.nat(this.m.i64(at + BigInt(i * 16 + 8)), "iovec length", MAX_IO - done);
      this.mem(p, z, true); const b = await this.read(fd, z); this.m.write(p, b); done += b.length; if (b.length < z) break;
    }
    return done;
  }

  private async writev(fd: number, at: bigint, n: number): Promise<number> {
    this.mem(at, n * 16); let done = 0;
    for (let i = 0; i < n; i++) {
      const p = this.m.u64(at + BigInt(i * 16)), z = this.nat(this.m.i64(at + BigInt(i * 16 + 8)), "iovec length", MAX_IO - done);
      this.mem(p, z); const q = await this.write(fd, this.m.read(p, z)); done += q;
      if (q < z) break;
    }
    return done;
  }

  private mmap(addr0: bigint, len0: bigint, prot0: bigint, flags0: bigint, fd0: bigint, off0: bigint): bigint {
    // Fixed ranges cannot collide with the image; flexible mappings search free space and retain backing-file metadata for shared flushes.
    const z0 = this.nat(len0, "mapping length", Number.MAX_SAFE_INTEGER), z = al(BigInt(z0));
    if (!z) bad("EINVAL", "zero-length mapping");
    const prot = this.nat(prot0, "mapping protection", 7), flags = this.nat(flags0, "mapping flags", 0x7fffffff);
    const at = thistleMapHostFile(requireValue(this.nativeMemory, "native memory"), this.thistleActiveHart,
      ux(addr0), BigInt(z0), BigInt(prot), BigInt(flags));
    if (at < 0n) bad("ENOMEM", "RV64 file mapping reservation failed");
    let path: string | null = null;
    let off = 0;
    if (!(flags & 0x20) && fd0 >= 0n) {
      const fd = this.fd(fd0), f = this.s.p.fds.get(fd) ?? bad("EBADF", String(fd));
      path = f.path ?? bad("EBADF", String(fd));
      off = this.nat(off0, "mapping offset", Number.MAX_SAFE_INTEGER);
      const b = this.s.readb(path).slice(off, off + z0);
      this.m.write(at, b);
    }
    const ent: MapEnt = {"path": null, "off": null, at, end: at + z, prot, shared: !!(flags & 1) };
    if (path !== null) {
      ent.path = path;
      ent.off = off;
    }
    this.maps.push(ent);
    if (at + z > this.mapAt) this.mapAt = al(at + z);
    return at;
  }

  private remap(old0: bigint, oz0: bigint, nz0: bigint): bigint {
    const old = ux(old0), oldSize = al(ux(oz0)), newSize = al(ux(nz0));
    const carrier = this.maps.find(mapping => mapping.path !== null && mapping.at === old && mapping.end === old + oldSize)
      ?? bad("EINVAL", "missing host mapping carrier");
    if (newSize < oldSize) this.flushShared(old + newSize, this.nat(oldSize - newSize, "truncated mapping", Number.MAX_SAFE_INTEGER));
    const result = thistleRemapHostFile(requireValue(this.nativeMemory, "canonical memory"), this.thistleActiveHart);
    if (result < 0n) return result;
    carrier.at = ux(result);
    carrier.end = ux(result) + newSize;
    return result;
  }

  private unmap(at0: bigint, len: number): void {
    // Flush shared bytes before releasing frames, then split surviving file ranges with adjusted offsets.
    const at = at0 & -PAGE, end = al(at0 + BigInt(len));
    this.flushShared(at, this.nat(end - at, "unmapped range", Number.MAX_SAFE_INTEGER));
    const result = thistleUnmapHostFile(requireValue(this.nativeMemory, "native memory"), this.thistleActiveHart, at, end - at);
    if (result < 0n) bad("EINVAL", "RV64 mapping release failed");
    for (let i = this.maps.length - 1; i >= 0; i--) {
      const q = requireValue(this.maps[i] ?? null, "src/vm/rv64.ts:2274");
      const lo = at > q.at ? at : q.at, hi = end < q.end ? end : q.end;
      if (lo < hi) this.m.drop(lo, this.nat(hi - lo, "unmapped range", Number.MAX_SAFE_INTEGER));
      switch (true) {
case !!(at <= q.at && end >= q.end): { this.maps.splice(i, 1);
break; }
case !!(at > q.at && end < q.end): {
        const old = q.end, next: MapEnt = {"path": null, "off": null, at: end, end: old, prot: q.prot, shared: q.shared };
        if (q.path !== null) next.path = q.path;
        if (q.off !== null) next.off = q.off + this.nat(end - q.at, "mapping offset", Number.MAX_SAFE_INTEGER);
        q.end = at;
        this.maps.push(next);

break; }
case !!(at <= q.at && end > q.at): {
        const old = q.at;
        q.at = end;
        if (q.off !== null) q.off += this.nat(end - old, "mapping offset", Number.MAX_SAFE_INTEGER);

break; }
case !!(at < q.end && end >= q.end): { q.end = at;
break; }
}
    }
  }

  private flushShared(at0: bigint, len: number): void {
    if (len <= 0) return;
    const at = at0 & -PAGE, end = al(at0 + BigInt(len));
    for (const q of this.maps) {
      if (!q.shared || !q.path || q.off === null) continue;
      const lo = at > q.at ? at : q.at, hi = end < q.end ? end : q.end;
      if (lo >= hi) continue;
      const rel = this.nat(lo - q.at, "mapping relative offset", Number.MAX_SAFE_INTEGER);
      const n = this.nat(hi - lo, "mapping flush length", Number.MAX_SAFE_INTEGER);
      const dst = q.off + rel, cur = this.s.readb(q.path), out = new Uint8Array(Math.max(cur.length, dst + n));
      out.set(cur);
      out.set(this.m.read(lo, n), dst);
      this.s.writeb(q.path, out);
    }
  }

  private flushAllShared(): void {
    for (const q of [...this.maps]) this.flushShared(q.at, this.nat(q.end - q.at, "mapping length", Number.MAX_SAFE_INTEGER));
  }

  private random(at: bigint, n: number): number { return randomFill(this.m, this.mem.bind(this), at, n); }

  private mem(at: bigint, n: number, wr = false): void {
    if (!this.executionActive) bad("EINTR", "expired guest image");
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff || at < 0n) bad("ERANGE", "invalid guest access range");
    checkNative(thistleGuestAccess(requireValue(this.nativeMemory, "canonical memory"), this.thistleActiveHart, this.s.pid, at, n, wr ? 2 : 1));
  }







  private fd(n: bigint): number { return this.nat(n, "file descriptor", 0x7fffffff); }
  private nat(n: bigint, k: string, max: number): number { const q = ux(n); if (n < 0n || q > BigInt(max)) bad("ERANGE", `${k} is out of range`); return Number(q); }
  private owner(n: bigint, k: string): number { const q = ux(n); if (q === 0xffffffffn) bad("EINVAL", `${k} is reserved`); if (q > 0xffffffffn) bad("ERANGE", `${k} is out of range`); return Number(q); }
  private idOrKeep(n: bigint): number | null {
    const value = ux(n);
    return value === 0xffffffffn || value === MASK ? null : this.owner(n, "identity");
  }

  private exit(n: bigint): void { this.flushAllShared(); this.code = Number(ux(n) & 0xffffffffn); this.done = true; }
}
