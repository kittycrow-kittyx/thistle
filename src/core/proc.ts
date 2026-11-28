import { changeDirectory, currentDirectory, inheritDirectory } from "../host/cwd.js";
import type { In, Out } from "../io/stream.js";
import { Fd, FdTable } from "./fd.js";
export { Fd, FdTable } from "./fd.js";
export type { FdFlags } from "./fd.js";
import type { HostProcess, HostProcessState, HostSignal } from "../host/process.js";
import type { ProcCred } from "../fs/vfs.js";

export type PState = HostProcessState;
export type Sig = HostSignal;

export interface Io {
  sin: In;
  sout: Out;
  serr: Out;
}

/** Internal control transfer used to replace a process image without changing its PID. */
export class ExecReplace extends Error {
  constructor(
    public readonly path: string,
    public readonly image: Uint8Array,
    public readonly args: string[],
    public readonly argv: string[],
    public readonly env: Map<string, string>,
    public readonly cred: ProcCred,
  ) {
    super(`exec ${path}`);
    this.name = "ExecReplace";
  }
}

export interface ProcInit {
  pgid: number;
  cmd: string;
  argv: string[];
  cwd: string;
  env: Map<string, string>;
  io: Io;
}

export class Proc {
  // Completion retains a terminal receipt after reaping; live state belongs to native memory.
  private finishedCode: number | null = null;
  private finishedSignal: Sig | null = null;
  get completed(): boolean { return this.finishedCode !== null; }
  get state(): PState { return this.finishedCode === null ? this.native.phase.state : "zombie"; }
  set state(value: PState) { this.native.setState(value); }
  get code(): number | null { return this.finishedCode ?? this.native.phase.code; }
  get sig(): Sig | null { return this.completed ? this.finishedSignal : this.native.lastSignal; }
  readonly born = Date.now();
  readonly ac = new AbortController();
  readonly fds: FdTable;
  get kids(): ReadonlySet<number> { return this.native.children; }
  allHeld = false;
  get signalMask(): bigint { return this.native.signalMask; }
  set signalMask(value: bigint) { this.setSignalMask(2, value); }
  readonly done: Promise<number>;
  private fin: ((n: number) => void) | null = null;

  get pid(): number { return this.native.pid; }
  get ppid(): number { return this.native.parentPid; }
  get pgid(): number { return this.native.groupId; }
  set pgid(value: number) { this.native.groupId = value; }
  cmd: string;
  argv: string[];
  get cwd(): string { return currentDirectory(this.native); }
  set cwd(path: string) { changeDirectory(this.native, path); }
  inheritCwd(parent: Proc): void { inheritDirectory(parent.native, this.native); }
  env: Map<string, string>;
  get cred(): ProcCred { return this.native.identity().credentials; }
  get fsuid(): number { return this.native.id("fsuid"); }
  get fsgid(): number { return this.native.id("fsgid"); }
  get mask(): number { return this.native.id("umask"); }
  set mask(value: number) { this.native.setUmask(value); }

  constructor(init: ProcInit, readonly native: HostProcess) {
    const { pgid, cmd, argv, cwd, env, io } = init;
    this.fds = new FdTable(native);
    this.pgid = pgid;
    this.cmd = cmd; this.argv = argv;
    if (cwd !== "/") this.cwd = cwd;
    this.env = env;
    this.fds.set(0, new Fd(io.sin, null, "/dev/stdin", { rd: true, wr: false, add: false, clo: false }));
    this.fds.set(1, new Fd(null, io.sout, "/dev/stdout", { rd: false, wr: true, add: false, clo: false }));
    this.fds.set(2, new Fd(null, io.serr, "/dev/stderr", { rd: false, wr: true, add: false, clo: false }));
    this.done = new Promise(ok => { this.fin = ok; });
  }

  input(fd = 0): In | null {
    const descriptor = this.fds.get(fd) ?? null;
    return descriptor === null ? null : descriptor.input;
  }

  output(fd = 1): Out | null {
    const descriptor = this.fds.get(fd) ?? null;
    return descriptor === null ? null : descriptor.output;
  }

  end(n: number): void {
    if (this.finishedCode !== null) return;
    this.native.finish(n & 0xff);
    this.finishedSignal = this.native.lastSignal;
    this.finishedCode = n & 0xff;
    const finish = this.fin;
    if (finish === null) throw new Error("missing process completion resolver");
    finish(this.finishedCode);
  }

  signal(s: Sig): boolean {
    if (this.completed) return s === 0;
    const deliver = this.native.queueSignal(s);
    if (deliver && s !== 0) this.deliverSignal(s);
    return deliver;
  }

  setSignalMask(how: 0 | 1 | 2, mask: bigint): bigint {
    const change = this.native.changeSignalMask(how, mask);
    if (change.signal !== null) this.deliverSignal(change.signal);
    return change.previous;
  }

  private deliverSignal(signal: Sig): void { this.ac.abort(new Error(`signal ${signal}`)); }

  ms(): number { return Date.now() - this.born; }
}
