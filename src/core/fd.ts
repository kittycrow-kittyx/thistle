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

  static fromNative(native: HostDescriptor): Fd {
    const descriptor = new Fd();
    descriptor.native = native;
    descriptor.draft = null;
    return descriptor;
  }

  matches(native: HostDescriptor): boolean {
    const current = this.native;
    return current !== null && current.process === native.process &&
      current.number === native.number && current.identity === native.identity;
  }

  get inode(): number { return this.native === null ? 0 : this.native.inode; }

  readFile(length: number): Uint8Array { return (this.native ?? bad("EBADF")).readFile(length); }
  writeFile(bytes: Uint8Array): number { return (this.native ?? bad("EBADF")).writeFile(bytes); }
  async materialiseFile(): Promise<void> {
    const native = this.native;
    if (native !== null && native.inode !== 0) await native.materialiseFile();
  }
  seekFile(offset: number, whence: number): number { return (this.native ?? bad("EBADF")).seekFile(offset, whence); }

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
export class FdTable {
  private readonly capabilities = new Map<number, Fd>();

  constructor(private readonly process: HostProcess) {}

  next(minimum = 3): number { return HostDescriptor.next(this.process, minimum); }
  get size(): number { return HostDescriptor.active(this.process).length; }

  private view(native: HostDescriptor): Fd {
    const attached = this.capabilities.get(native.number) ?? null;
    return attached !== null && attached.matches(native) ? attached : Fd.fromNative(native);
  }

  get(number: number): Fd | null {
    const native = HostDescriptor.find(this.process, number);
    return native === null ? null : this.view(native);
  }

  has(number: number): boolean { return HostDescriptor.find(this.process, number) !== null; }

  /** Cleanup may release host endpoints after the process record has been reaped. */
  attachment(number: number): Fd | null { return this.capabilities.get(number) ?? null; }
  attachments(): Fd[] { return [...this.capabilities.values()]; }

  set(number: number, descriptor: Fd): this {
    descriptor.bind(this.process, number);
    this.capabilities.set(number, descriptor);
    return this;
  }

  delete(number: number): boolean {
    const descriptor = this.get(number);
    if (descriptor === null) return false;
    descriptor.closeNative();
    this.capabilities.delete(number);
    return true;
  }

  clear(): void {
    for (const number of this.keys()) this.delete(number);
  }

  keys(): number[] { return HostDescriptor.active(this.process).map(view => view.number); }
  values(): Fd[] { return HostDescriptor.active(this.process).map(view => this.view(view)); }
  entries(): Array<[number, Fd]> { return HostDescriptor.active(this.process).map(view => [view.number, this.view(view)]); }
}
