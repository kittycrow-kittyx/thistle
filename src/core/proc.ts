import type { In, Out } from "../io/stream.js";
import type { HostProcess } from "../host/process.js";
import type { ProcCred } from "../fs/vfs.js";

export type PState = "ready" | "run" | "sleep" | "stop" | "zombie";
export type Sig = 0 | 1 | 2 | 9 | 13 | 15;

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

export interface FdFlags { rd: boolean; wr: boolean; add: boolean; clo: boolean }

export class Fd {
  pos = 0;

  constructor(
    public input: In | null = null,
    public output: Out | null = null,
    public path: string | null = null,
    flags: FdFlags = { rd: false, wr: false, add: false, clo: false },
  ) { this.rd = flags.rd; this.wr = flags.wr; this.add = flags.add; this.clo = flags.clo; }

  rd: boolean;
  wr: boolean;
  add: boolean;
  clo: boolean;

  hold(): void {
    if (this.input !== null) this.input.holdR();
    if (this.output !== null) this.output.hold();
  }

  release(): void {
    if (this.input !== null) this.input.releaseR();
    if (this.output !== null) this.output.close();
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
  state: PState = "ready";
  code: number | null = null;
  sig: Sig | null = null;
  readonly born = Date.now();
  readonly ac = new AbortController();
  readonly fds = new Map<number, Fd>();
  readonly kids = new Set<number>();
  allHeld = false;
  signalMask = 0n;
  private pending: Sig | null = null;
  readonly done: Promise<number>;
  private fin: ((n: number) => void) | null = null;

  get pid(): number { return this.native.pid; }
  get ppid(): number { return this.native.parentPid; }
  get pgid(): number { return this.native.groupId; }
  set pgid(value: number) { this.native.groupId = value; }
  cmd: string;
  argv: string[];
  cwd: string;
  env: Map<string, string>;
  get cred(): ProcCred { return this.native.identity().credentials; }
  get fsuid(): number { return this.native.id("fsuid"); }
  get fsgid(): number { return this.native.id("fsgid"); }
  get mask(): number { return this.native.id("umask"); }
  set mask(value: number) { this.native.setUmask(value); }

  constructor(init: ProcInit, readonly native: HostProcess) {
    const { pgid, cmd, argv, cwd, env, io } = init;
    this.pgid = pgid;
    this.cmd = cmd; this.argv = argv; this.cwd = cwd;
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
    if (this.code !== null) return;
    this.native.finish(n & 0xff);
    this.code = n & 0xff;
    this.state = "zombie";
    const finish = this.fin;
    if (finish === null) throw new Error("missing process completion resolver");
    finish(this.code);
  }

  signal(s: Sig): boolean {
    if (s === 0) return true;
    if (this.code !== null) return false;
    const bit = 1n << BigInt(s - 1);
    if (s !== 9 && (this.signalMask & bit)) { this.pending = s; return false; }
    this.sig = s;
    this.ac.abort(new Error(`signal ${s}`));
    return true;
  }

  setSignalMask(how: 0 | 1 | 2, mask: bigint): bigint {
    const old = this.signalMask, kill = 1n << 8n;
    switch (how) {
      case 0: this.signalMask |= mask; break;
      case 1: this.signalMask &= ~mask; break;
      default: this.signalMask = mask;
    }
    this.signalMask &= ~kill;
    const p = this.pending;
    if (p !== null && !(this.signalMask & (1n << BigInt(p - 1)))) {
      this.pending = null;
      this.signal(p);
    }
    return old;
  }

  ms(): number { return Date.now() - this.born; }
}
