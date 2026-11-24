import type { In, Out } from "../io/stream.js";
import { bad } from "./err.js";
import { HostDescriptor } from "../host/descriptor.js";
import type { HostProcess } from "../host/process.js";
import { THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_FD_APPEND, THISTLE_FD_CLOEXEC } from "../native/abi.js";

export interface FdFlags { rd: boolean; wr: boolean; add: boolean; clo: boolean }
interface FdDraft { flags: number; offset: number }

const bits = (flags: FdFlags): number =>
  (flags.rd ? THISTLE_FD_READ : 0) | (flags.wr ? THISTLE_FD_WRITE : 0) |
  (flags.add ? THISTLE_FD_APPEND : 0) | (flags.clo ? THISTLE_FD_CLOEXEC : 0);

/** Host endpoints and a detached request until installed in canonical memory. */
export class Fd {
  private draft: FdDraft | null;
  private native: HostDescriptor | null = null;

  constructor(
    public input: In | null = null,
    public output: Out | null = null,
    public path: string | null = null,
    flags: FdFlags = { rd: false, wr: false, add: false, clo: false },
  ) { this.draft = { flags: bits(flags), offset: 0 }; }

  bind(process: HostProcess, number: number): void {
    const draft = this.draft ?? bad("EINVAL", "descriptor request already installed");
    this.native = HostDescriptor.install(process, number, draft.flags, draft.offset);
    this.draft = null;
  }

  closeNative(): void {
    const native = this.native ?? bad("EBADF", "descriptor not installed");
    native.close();
  }

  private flag(bit: number): boolean {
    const native = this.native;
    const flags = native === null ? (this.draft ?? bad("EBADF")).flags : native.flags;
    return (flags & bit) !== 0;
  }

  private setFlag(bit: number, enabled: boolean): void {
    const native = this.native;
    if (native !== null) { native.setFlag(bit, enabled); return; }
    const draft = this.draft ?? bad("EBADF");
    draft.flags = enabled ? draft.flags | bit : draft.flags & ~bit;
  }

  get rd(): boolean { return this.flag(THISTLE_FD_READ); }
  set rd(value: boolean) { this.setFlag(THISTLE_FD_READ, value); }
  get wr(): boolean { return this.flag(THISTLE_FD_WRITE); }
  set wr(value: boolean) { this.setFlag(THISTLE_FD_WRITE, value); }
  get add(): boolean { return this.flag(THISTLE_FD_APPEND); }
  set add(value: boolean) { this.setFlag(THISTLE_FD_APPEND, value); }
  get clo(): boolean { return this.flag(THISTLE_FD_CLOEXEC); }
  set clo(value: boolean) { this.setFlag(THISTLE_FD_CLOEXEC, value); }

  get pos(): number {
    const native = this.native;
    return native === null ? (this.draft ?? bad("EBADF")).offset : native.offset;
  }

  set pos(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) bad("EINVAL", "invalid descriptor offset");
    const native = this.native;
    if (native !== null) { native.offset = value; return; }
    const draft = this.draft ?? bad("EBADF");
    draft.offset = value;
  }

  hold(): void {
    if (this.input !== null) this.input.holdR();
    if (this.output !== null) this.output.hold();
  }

  release(): void {
    if (this.input !== null) this.input.releaseR();
    if (this.output !== null) this.output.close();
  }
}

/** Host capability attachments, with allocation, flags and offsets in native slots. */
export class FdTable implements Iterable<[number, Fd]> {
  private readonly capabilities = new Map<number, Fd>();

  constructor(private readonly process: HostProcess) {}

  next(minimum = 3): number { return HostDescriptor.next(this.process, minimum); }
  get size(): number { return this.capabilities.size; }
  get(number: number): Fd | null { return this.capabilities.get(number) ?? null; }
  has(number: number): boolean { return this.capabilities.has(number); }

  set(number: number, descriptor: Fd): this {
    descriptor.bind(this.process, number);
    this.capabilities.set(number, descriptor);
    return this;
  }

  delete(number: number): boolean {
    const descriptor = this.get(number);
    if (descriptor === null) return false;
    descriptor.closeNative();
    return this.capabilities.delete(number);
  }

  clear(): void {
    for (const number of this.capabilities.keys()) this.delete(number);
  }

  keys(): IterableIterator<number> { return this.capabilities.keys(); }
  values(): IterableIterator<Fd> { return this.capabilities.values(); }
  entries(): IterableIterator<[number, Fd]> { return this.capabilities.entries(); }
  [Symbol.iterator](): IterableIterator<[number, Fd]> { return this.entries(); }
}
