import { HostContext } from "../host/context.js";
import { App } from "../apps/base.js";
import { bad, KErr, msg, requireValue } from "./err.js";
import { MemIn, MemOut, enc } from "../io/stream.js";
import type { In, Out } from "../io/stream.js";
import { Reg, Vfs } from "../fs/vfs.js";
import { credGid, credUid, fullCred } from "../fs/vfs.js";
import type { Cred, ProcCred } from "../fs/vfs.js";
import { ExecReplace, Fd, Proc } from "./proc.js";
import type { Io, Sig } from "./proc.js";
import { Sched } from "./sched.js";
import { accountIdentity, defaultKernelOptions } from "./host-options.js";
import type { HostAccount, KernelOptions } from "./host-options.js";
import { executeImage, validateExecutable } from "./guest.js";
export type { KernelOptions } from "./host-options.js";

export interface StartIo {
  sin: In | null;
  sout: Out | null;
  serr: Out | null;
}

export interface Start {
  io: StartIo | null;
  fds: Map<number, Fd> | null;
  pgid: number | null;
  cwd: string | null;
  env: Map<string, string> | null;
}

export const emptyStart = (): Start => ({ io: null, fds: null, pgid: null, cwd: null, env: null });

export interface PInfo {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  state: string;
  ms: number;
  cmd: string;
}

export interface Mnt { src: string; at: string; kind: string; opt: string; }

const root = accountIdentity().cred;

const procFsCred = (p: Proc): Cred => ({
  uid: p.fsuid,
  gid: p.fsgid,
  groups: [...p.cred.groups],
});

function closeDistinctError(p: Proc): void {
  const output = p.output(2);
  if (output !== null && output !== p.output(1)) output.close();
}

function releaseStandardIo(p: Proc): void {
  const input = p.input(0), output = p.output(1);
  if (input !== null) input.releaseR();
  if (output !== null) output.close();
  closeDistinctError(p);
}

function holdStandardIo(io: Io): void {
  io.sin.holdR();
  io.sout.hold();
  if (io.serr !== io.sout) io.serr.hold();
}

function replaceProcessImage(p: Proc, error: ExecReplace): void {
  for (const [fd, descriptor] of [...p.fds]) {
    if (!descriptor.clo) continue;

    descriptor.release();
    p.fds.delete(fd);
  }

  p.cmd = error.path;
  p.argv = [...error.argv];
  p.env = new Map(error.env);
  p.native.installIdentity(fullCred(error.cred));

}

export class Kern {
  readonly canonical = new HostContext();
  readonly fs: Vfs;
  readonly apps = new Map<string, App>();
  readonly procs = new Map<number, Proc>();
  readonly logs: string[] = [];
  readonly sched = new Sched(this.canonical);
  readonly born = Date.now();
  name: string;
  readonly release: string;
  host = "thistle";
  executionCore = "Thistle TypeScript";
  disk = false;
  ttyFn: (s: string, err: boolean) => void = () => {};
  private haltFn: (() => void) | null = null;

  readonly net: KernelOptions["net"];
  readonly lim: KernelOptions["lim"];
  readonly config: KernelOptions["config"];
  readonly setId: boolean;
  readonly wasiGuest: KernelOptions["wasiGuest"];

  constructor(options: KernelOptions = defaultKernelOptions()) {
    const { net, lim, config, setId, wasiGuest } = options;
    this.net = net; this.lim = lim; this.config = config; this.setId = setId; this.wasiGuest = wasiGuest;
    this.fs = new Vfs(lim.fs);
    this.name = config.kernel.name;
    this.release = config.kernel.version;
    this.host = config.hostName;
    net.log = s => this.log(s);
  }

  setHalt(fn: () => void): void { this.haltFn = fn; }
  tty(s: string, err = false): void { this.ttyFn(s, err); }

  log(s: string): void {
    const t = ((Date.now() - this.born) / 1000).toFixed(3).padStart(8);
    this.logs.push(`[${t}] ${s}`);
  }

  init(): Proc {
    if (this.procs.has(1)) return requireValue(this.procs.get(1) ?? null, "this.procs.get(1)");
    const z = new MemOut();
    const p = new Proc({ pgid: 1, cmd: "init", argv: ["init"], cwd: "/", env: this.baseEnv(), io: { sin: new MemIn(), sout: z, serr: z } }, this.canonical.create(1, 0, root));
    p.state = "sleep";
    this.procs.set(1, p);
    this.log("init: process 1 entered service loop");
    return p;
  }

  session(io: Io, account: HostAccount | null = null): Proc {
    this.init();
    const { cred, name, home } = accountIdentity(account);
    const pid = this.canonical.nextPid();
    const env = this.baseEnv();
    env.set("HOME", home);
    env.set("USER", name);
    env.set("PWD", home);
    const p = new Proc({ pgid: pid, cmd: "thsh", argv: ["thsh"], cwd: home, env, io }, this.canonical.create(pid, 1, cred));
    holdStandardIo(io);
    p.state = "run";
    this.procs.set(pid, p);
    this.log(`tty: session pid=${pid} uid=${credUid(cred)}`);
    return p;
  }

  private baseEnv(): Map<string, string> {
    return new Map([
      ["PATH", "/bin:/usr/bin:/sbin:/usr/sbin"], ["HOME", "/root"], ["USER", "root"],
      ["SHELL", "/bin/thsh"], ["TERM", this.config.terminal.term], ["LANG", this.config.terminal.lang],
      ["HOSTNAME", this.host], ["PS1", "\\u@\\h:\\w\\$ "],
    ]);
  }

  reg(a: App): void { this.apps.set(a.name, a); }

  install(a: App): void {
    this.reg(a);
    const p = `/bin/${a.name}`;
    const c = root;
    try { this.fs.mkfile(p, `#!thistle:${a.name}\n`, "/", c, 0o755); }
    catch (e) { if (!(e instanceof KErr) || e.code !== "EEXIST") throw e instanceof Error ? e : new Error(typeof e === "string" ? e : "non-Error kernel exception"); }
  }

  which(name: string, p: Proc): string {
    if (name.includes("/")) {
      const c = procFsCred(p);
      const q = this.fs.at(name, p.cwd, c).path;
      this.fs.need(this.fs.at(q, "/", c).node, c, 1, q);
      return q;
    }
    for (const d of (p.env.get("PATH") ?? "/bin").split(":")) {
      const q = `${d.replace(/\/$/, "")}/${name}`;
      try {
        const c = procFsCred(p);
        const h = this.fs.at(q, p.cwd, c);
        this.fs.need(h.node, c, 1, q);
        if (h.node instanceof Reg) return h.path;
      } catch (error) {
        if (!(error instanceof KErr) || !["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-Error kernel exception");
      }
    }
    return bad("ENOENT", `${name}: command not found`);
  }


  private executableCred(path: string, node: Reg, base: ProcCred): ProcCred {
    let cred = fullCred(base);
    const mode = node.mode;
    const privileged = this.setId && !!(mode & 0o6000);

    if (!privileged) return cred;

    const text = new TextDecoder().decode(node.head(64));

    if (text.startsWith("#!")) {
      bad("EACCES", `${path}: set-ID scripts are not supported`);
    }

    if (mode & 0o4000) {
      cred = { ...cred, euid: node.uid, uid: node.uid, suid: node.uid };
    }

    if (mode & 0o2000) {
      cred = { ...cred, egid: node.gid, gid: node.gid, sgid: node.gid };
    }

    return cred;
  }

  start(name: string, argv: string[], par: Proc, opt: Start = emptyStart()): Proc {
    // Retain shared pipe endpoints before the child starts; explicit descriptor tables own their own references.
    const path = this.which(name, par);
    const h = this.fs.at(path, par.cwd, procFsCred(par));
    const node = h.node instanceof Reg ? h.node : bad("ENOEXEC", path);
    const pid = this.canonical.nextPid();
    const streams = opt.io;
    const io: Io = {
      sin: (streams === null ? null : streams.sin) ?? par.input(0) ?? new MemIn(),
      sout: (streams === null ? null : streams.sout) ?? par.output(1) ?? new MemOut(),
      serr: (streams === null ? null : streams.serr) ?? par.output(2) ?? new MemOut(),
    };
    if (!opt.fds) holdStandardIo(io);
    const cred = this.executableCred(path, node, par.cred);
    const p = new Proc({ pgid: opt.pgid ?? pid, cmd: path, argv: [name, ...argv], cwd: opt.cwd ?? par.cwd, env: new Map(opt.env ?? par.env), io }, this.canonical.create(pid, par.pid, cred));
    if (opt.fds) {
      p.fds.clear(); p.allHeld = true;
      for (const [n, f] of opt.fds) {
        f.hold();
        const q = new Fd(f.input, f.output, f.path, { rd: f.rd, wr: f.wr, add: f.add, clo: f.clo }); q.pos = f.pos; p.fds.set(n, q);
      }
    }
    p.mask = par.mask;
    this.procs.set(pid, p);
    this.sched.add(p, () => this.runMaterialised(p, path, node, argv));
    return p;
  }

  /**
   * The task closure stays synchronous. The asynchronous materialisation is a
   * named Thistle kernel method, which Bake can lower to a native coroutine
   * without synthesising an asynchronous capturing closure.
   */
  private async runMaterialised(p: Proc, path: string, node: Reg, argv: string[]): Promise<void> {
    const image = (await node.materialise()).slice();
    await this.run(p, path, image, argv);
  }

  async exec(name: string, argv: string[], env: Map<string, string>, p: Proc): Promise<never> {
    const credential = procFsCred(p);
    const handle = this.fs.at(name, p.cwd, credential);

    this.fs.need(handle.node, credential, 1, handle.path);

    const node = handle.node instanceof Reg
      ? handle.node
      : bad("ENOEXEC", handle.path);

    const image = (await node.materialise()).slice();

    validateExecutable(this.apps, handle.path, image);

    const fullArgv = argv.length
      ? [...argv]
      : [name];

    throw new ExecReplace(
      handle.path,
      image,
      fullArgv.slice(1),
      fullArgv,
      new Map(env),
      this.executableCred(handle.path, node, p.cred),
    );
  }


  private async processFailure(p: Proc, error: Error | string): Promise<number> {
    if (p.sig) return 128 + p.sig;
    if (error instanceof KErr && error.code === "EPIPE") return 141;
    const code = error instanceof KErr ? error.code === "EINTR" ? 130 : error.code === "ENOEXEC" || error.code === "EACCES" ? 126 : error.code === "ENOENT" ? 127 : 1 : 1;
    const output = p.output(2);
    if (output !== null) await output.wr(enc(`${p.argv[0] ?? p.cmd}: ${msg(error)}\n`));
    return code;
  }

  private async run(p: Proc, path: string, bin: Uint8Array, argv: string[]): Promise<void> {
    // ExecReplace keeps the PID while replacing image, descriptors and credentials; termination releases retained references once.
    p.state = "run";
    let code = 126;
    try {
      for (;;) {
        try {
          code = await executeImage(this, p, path, bin, argv);

          break;
        } catch (error) {
          if (!(error instanceof ExecReplace)) throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-Error kernel exception");

          replaceProcessImage(p, error);

          path = error.path;
          bin = error.image;
          argv = error.args;


          this.log(`proc: pid=${p.pid} exec=${path}`);
        }
      }
    } catch (e) {
      code = await this.processFailure(p, e instanceof Error ? e : typeof e === "string" ? e : "non-Error process failure");
    } finally {
      if (p.allHeld) {
        for (const f of p.fds.values()) f.release();
      } else {
        releaseStandardIo(p);
      }
      p.end(code);
      this.log(`proc: pid=${p.pid} exit=${code} cmd=${path}`);
    }
  }

  async wait(pid: number, par: Proc): Promise<number> {
    const p = this.procs.get(pid) ?? bad("ESRCH", String(pid));
    if (p.ppid !== par.pid && par.native.id("euid") !== 0) bad("ECHILD", String(pid));
    const n = await p.done;
    this.reap(pid, par);
    return n;
  }

  reap(pid: number, par: Proc | null = null): void {
    if (pid <= 2) return;
    const p = this.procs.get(pid) ?? null;
    if (!p || !p.completed) return;
    const owner = this.procs.get(p.ppid) ?? null;
    const init = this.procs.get(1) ?? null;
    const parent = requireValue(par ?? owner ?? init, "canonical reaper");
    this.canonical.reap(parent.native, pid);
    this.procs.delete(pid);
  }

  kill(id: number, sig: Sig, by: Proc): number {
    const q = [...this.procs.values()].filter(p => id < 0 ? p.pgid === -id : p.pid === id);
    if (!q.length) bad("ESRCH", String(id));
    let n = 0;
    for (const p of q) {
      if (p.pid === 1) continue;
      if (by.native.id("euid") !== 0 && by.native.id("ruid") !== p.native.id("ruid")) bad("EPERM", String(p.pid));
      const delivered = p.signal(sig);
      if (delivered && sig !== 0 && (sig === 9 || p.state === "sleep")) p.end(128 + sig);
      n++;
    }
    this.log(`signal: sig=${sig} target=${id} sender=${by.pid}`);
    return n;
  }

  ps(): PInfo[] {
    return [...this.procs.values()].sort((a, b) => a.pid - b.pid).map(p => ({
      pid: p.pid, ppid: p.ppid, pgid: p.pgid, uid: p.native.id("euid"),
      state: p.state, ms: p.ms(), cmd: p.argv.join(" "),
    }));
  }

  mounts(): Mnt[] {
    const a: Mnt[] = [
      { src: this.disk ? "hostfs" : "memfs", at: "/", kind: "thistlefs", opt: `rw,${this.setId ? "suid" : "nosuid"},relatime` },
      { src: "proc", at: "/proc", kind: "procfs", opt: "ro" },
      { src: "dev", at: "/dev", kind: "devfs", opt: "rw" },
    ];
    return a;
  }

  stop(by: Proc): void {
    if (by.native.id("euid") !== 0) bad("EPERM", "reboot");
    for (const p of this.procs.values()) if (p.pid !== 1 && p.pid !== by.pid) p.signal(15);
    this.log("system: reboot requested");
    if (this.haltFn !== null) this.haltFn();
  }

  fd(p: Proc): number {
    for (let n = 3; n < 256; n++) if (!p.fds.has(n)) return n;
    return bad("EMFILE", "descriptor table full");
  }

  cloneFd(p: Proc, old: number, nu: number | null = null): number {
    const f = p.fds.get(old) ?? bad("EBADF", String(old));
    const n = nu ?? this.fd(p);
    if (n === old) return n;
    const q = p.fds.get(n) ?? null;
    if (q !== null) q.release();
    f.hold();
    p.fds.set(n, new Fd(f.input, f.output, f.path, { rd: f.rd, wr: f.wr, add: f.add, clo: false }));
    return n;
  }
}
