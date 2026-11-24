import { changeDirectory, changeDirectoryInode, directoryPath } from "../host/cwd.js";
import { HostDescriptor } from "../host/descriptor.js";
import { fileKind, statView } from "../fs/vfs.js";
import type { Kind } from "../fs/vfs.js";
import type { HostInode } from "../host/inode.js";
import { bad, KErr } from "./err.js";
import { emptyStart } from "./kernel.js";
import type { Kern, PInfo, Start } from "./kernel.js";
import { Fd, Proc } from "./proc.js";
import type { Sig } from "./proc.js";
import { Reg } from "../fs/vfs.js";
import type { St, VNode } from "../fs/vfs.js";
import { dec, enc, Pipe } from "../io/stream.js";
import type { NReq, NRes } from "../net/net.js";

export class Sys {
  constructor(readonly k: Kern, readonly p: Proc) {}

  get pid(): number { return this.p.pid; }
  get ppid(): number { return this.p.ppid; }
  get uid(): number { return this.ruid; }
  get euid(): number { return this.p.native.id("euid"); }
  get suid(): number { return this.p.native.id("suid"); }
  get ruid(): number { return this.p.native.id("ruid"); }
  get gid(): number { return this.rgid; }
  get egid(): number { return this.p.native.id("egid"); }
  get sgid(): number { return this.p.native.id("sgid"); }
  get rgid(): number { return this.p.native.id("rgid"); }
  get groups(): number[] { return [...this.p.cred.groups]; }
  get cwd(): string { return this.p.cwd; }
  get umask(): number { return this.p.mask; }
  set umask(n: number) { this.p.mask = n & 0o777; }

  setResuid(ruid: number | null = null, euid: number | null = null, suid: number | null = null): void {
    this.p.native.setIdentity(0, ruid, euid, suid);
  }

  setResgid(rgid: number | null = null, egid: number | null = null, sgid: number | null = null): void {
    this.p.native.setIdentity(1, rgid, egid, sgid);
  }

  setReuid(ruid: number | null = null, euid: number | null = null): void {
    this.p.native.setIdentity(2, ruid, euid);
  }

  setRegid(rgid: number | null = null, egid: number | null = null): void {
    this.p.native.setIdentity(3, rgid, egid);
  }

  setUid(uid: number): void { this.p.native.setIdentity(4, uid); }
  setGid(gid: number): void { this.p.native.setIdentity(5, gid); }
  setFsuid(uid: number): number { return this.p.native.setIdentity(6, uid); }
  setFsgid(gid: number): number { return this.p.native.setIdentity(7, gid); }
  setGroups(groups: number[]): void { this.p.native.setGroups(groups); }

  async inb(): Promise<Uint8Array> {
    const input = this.p.input(0) ?? bad("EBADF", "stdin");
    const q: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const b = await input.rd(this.p.ac.signal);
      if (!b.length) break;
      q.push(b);
      n += b.length;
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const b of q) { out.set(b, at); at += b.length; }
    return out;
  }

  async chunkb(): Promise<Uint8Array> {
    const input = this.p.input(0) ?? bad("EBADF", "stdin");
    return input.rd(this.p.ac.signal);
  }

  async chunk(): Promise<string> { return dec(await this.chunkb()); }

  async input(): Promise<string> { return dec(await this.inb()); }

  async out(s: string | Uint8Array): Promise<number> {
    const out = this.p.output(1) ?? bad("EBADF", "stdout");
    return out.wr(typeof s === "string" ? enc(s) : s);
  }

  async err(s: string | Uint8Array): Promise<number> {
    const out = this.p.output(2) ?? bad("EBADF", "stderr");
    return out.wr(typeof s === "string" ? enc(s) : s);
  }

  env(): Map<string, string>;
  env(k: string): string | null;
  env(k: string | null = null): string | Map<string, string> | null {
    return k === null ? new Map(this.p.env) : this.p.env.get(k) ?? null;
  }

  setenv(k: string, v: string): void { this.p.env.set(k, v); }
  unset(k: string): void { this.p.env.delete(k); }

  cd(path: string): void {
    const previous = this.cwd;
    changeDirectory(this.p.native, path);
    this.setenv("OLDPWD", previous);
    this.setenv("PWD", this.cwd);
  }

  read(path: string): string { return this.k.fs.read(path, this.p.native); }
  readb(path: string): Uint8Array { return this.k.fs.readb(path, this.p.native); }

  async materialise(path: string): Promise<Reg> {
    const node = this.k.fs.at(path, this.p.native).node;
    if (!(node instanceof Reg)) return bad("EISDIR", path);
    await node.materialise();
    return node;
  }

  write(p: string, x: string, add = false, mode = 0o666): void { this.k.fs.write(p, x, this.p.native, add, mode & ~this.umask); }
  writeb(p: string, x: Uint8Array, add = false, mode = 0o666): void { this.k.fs.writeb(p, x, this.p.native, add, mode & ~this.umask); }
  mkfile(p: string, x: string | Uint8Array = "", mode = 0o666): void { this.k.fs.mkfile(p, x, this.p.native, mode & ~this.umask); }
  mkdir(p: string, mode = 0o777): void { this.k.fs.mkdir(p, this.p.native, mode & ~this.umask); }
  list(p = "."): Array<[string, VNode]> { return this.k.fs.list(p, this.p.native); }
  rm(p: string, dir = false): void { this.k.fs.rm(p, this.p.native, dir); }
  mv(a: string, b: string): void { this.k.fs.rename(a, b, this.p.native); }
  link(a: string, b: string): void { this.k.fs.link(a, b, this.p.native); }
  symlink(a: string, b: string): void { this.k.fs.symlink(a, b, this.p.native); }
  readlink(p: string): string { return this.k.fs.readlink(p, this.p.native); }
  chmod(p: string, mode: number): void { this.k.fs.chmod(p, mode, this.p.native); }
  chown(p: string, uid: number, gid: number): void { this.k.fs.chown(p, uid, gid, this.p.native); }
  utime(p: string, at: number, mt: number, follow = true): void { this.k.fs.utime(p, at, mt, this.p.native, follow); }
  stat(p: string, follow = true): St { return this.k.fs.stat(p, this.p.native, follow); }
  node(p: string, follow = true): VNode { return this.k.fs.at(p, this.p.native, follow).node; }
  paths(p = "."): string[] { return this.k.fs.paths(p, this.p.native); }
  glob(p: string): string[] { return this.k.fs.glob(p, this.p.native); }

  open(path: string, flags = "r", mode = 0o666): number {
    const rd = flags.includes("r") || flags.includes("+"), wr = /[wa+]/.test(flags), add = flags.startsWith("a");
    if (path === "/dev/tty") {
      const n = this.k.fd(this.p);
      this.p.fds.set(n, new Fd(this.p.input(0), this.p.output(1), null, { rd, wr, add, clo: false }));
      return n;
    }
    const access = rd && wr ? 2 : wr ? 1 : 0;
    const nativeFlags = access | (wr ? 0x40 : 0) | (flags.startsWith("w") ? 0x200 : 0) | (add ? 0x400 : 0);
    const descriptor = HostDescriptor.openPath(this.p.native, path, nativeFlags, mode);
    if (descriptor.kind === 3) { descriptor.close(); return bad("EISDIR", path); }
    return descriptor.number;
  }

  openDir(path: string): number { return HostDescriptor.openPath(this.p.native, path, 0x10000).number; }

  pipe(): [number, number] {
    const p = new Pipe(), rd = this.k.fd(this.p);
    this.p.fds.set(rd, new Fd(p, null, null, { rd: true, wr: false, add: false, clo: false }));
    p.holdR();
    const wr = this.k.fd(this.p);
    this.p.fds.set(wr, new Fd(null, p, null, { rd: false, wr: true, add: false, clo: false }));
    p.hold();
    return [rd, wr];
  }

  close(fd: number): void {
    const f = this.p.fds.get(fd) ?? bad("EBADF", String(fd));
    this.p.fds.delete(fd);
    f.release();
  }

  dup(fd: number, nu: number | null = null): number { return this.k.cloneFd(this.p, fd, nu); }

  fdr(fd: number, len = 65536): Uint8Array {
    return (this.p.fds.get(fd) ?? bad("EBADF", String(fd))).readFile(len);
  }

  fdw(fd: number, bytes: Uint8Array): number {
    return (this.p.fds.get(fd) ?? bad("EBADF", String(fd))).writeFile(bytes);
  }

  seek(fd: number, off: number, whence = 0): number {
    return (this.p.fds.get(fd) ?? bad("EBADF", String(fd))).seekFile(off, whence);
  }

  private fdInode(fd: number): HostInode {
    const descriptor = this.p.fds.get(fd) ?? bad("EBADF", String(fd));
    return descriptor.inodeView() ?? bad("EBADF", String(fd));
  }

  fdStat(fd: number): St { return statView(this.fdInode(fd)); }

  fdList(fd: number): Array<[string, { ino: number; kind: Kind }]> {
    const descriptor = this.p.fds.get(fd) ?? bad("EBADF", String(fd));
    return descriptor.directoryEntries().map(item => [item.name, { ino: item.inode, kind: fileKind(item.kind) }]);
  }

  fdPath(fd: number): string { return directoryPath(this.p.native, this.fdInode(fd)); }

  fdChdir(fd: number): void {
    const previous = this.cwd;
    changeDirectoryInode(this.p.native, this.fdInode(fd));
    this.setenv("OLDPWD", previous);
    this.setenv("PWD", this.cwd);
  }

  fdChmod(fd: number, mode: number): void { this.fdInode(fd).chmod(this.p.native, mode); }
  fdChown(fd: number, uid: number, gid: number): void { this.fdInode(fd).chown(this.p.native, uid, gid); }
  fdUtime(fd: number, at: number, mt: number): void { this.fdInode(fd).utime(this.p.native, BigInt(at), BigInt(mt)); }

  start(name: string, a: string[], opt: Start = emptyStart()): Proc { return this.k.start(name, a, this.p, opt); }
  exec(name: string, argv: string[], env: Map<string, string>): Promise<never> { return this.k.exec(name, argv, env, this.p); }
  wait(pid: number): Promise<number> { return this.k.wait(pid, this.p); }
  reap(pid: number): void { this.k.reap(pid, this.p); }
  kill(pid: number, sig: Sig = 15): number { return this.k.kill(pid, sig, this.p); }
  ps(): PInfo[] { return this.k.ps(); }
  which(name: string): string { return this.k.which(name, this.p); }
  apps(): AppInfo[] { return [...this.k.apps.values()].map(x => ({ name: x.name, desc: x.desc, use: x.use })).sort((a, b) => a.name.localeCompare(b.name)); }
  uptime(): number { return Date.now() - this.k.born; }
  logs(): string[] { return [...this.k.logs]; }
  net(r: NReq): Promise<NRes> { return this.k.net.req(r, this.p.ac.signal); }
  reboot(): void { this.k.stop(this.p); }

  async sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) bad("EINVAL", String(ms));
    this.p.state = "sleep";
    try {
      await new Promise<void>((ok, no) => {
        const id = setTimeout(ok, ms);
        this.p.ac.signal.addEventListener("abort", () => { clearTimeout(id); no(new KErr("EINTR", "interrupted")); }, { once: true });
      });
    } finally {
      if (this.p.code === null) this.p.state = "run";
    }
  }

  yield(): Promise<void> { return this.k.sched.yield(this.p); }

  chk(): void { if (this.p.ac.signal.aborted) bad("EINTR", "interrupted"); }
}

export interface AppInfo { name: string; desc: string; use: string; }
