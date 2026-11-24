import { bad, KErr } from "../core/err.js";
import { dec, enc } from "../io/stream.js";
import { HostInode } from "../host/inode.js";
import { HostDescriptor } from "../host/descriptor.js";
import type { HostProcess } from "../host/process.js";
import { RootVolume } from "../host/root.js";
import { Chr, Dir, Reg, Sym, nodeView, statView } from "./nodes.js";
import type { VNode } from "./nodes.js";
import { norm, wild, wrx, splitParent, absolutePath } from "./paths.js";
import type { TreeEnt } from "./tree.js";

export { Chr, Dir, Reg, Sym, VNode, fmtMode, nodeView, statView, fileKind } from "./nodes.js";
export { norm } from "./paths.js";
export type { RegSource } from "../host/bytes.js";

export interface Cred {
  uid: number;
  gid: number;
  groups: number[];
}

export interface ProcCred extends Cred {
  ruid: number;
  euid: number;
  suid: number;
  rgid: number;
  egid: number;
  sgid: number;
}

export type SessionCred = Cred | ProcCred;

/** Expand a filesystem identity into a complete process identity. */
export const fullCred = (cred: SessionCred): ProcCred => {
  if ("euid" in cred) return { ...cred, uid: cred.euid, gid: cred.egid, groups: [...cred.groups] };
  const { uid, gid } = cred;
  return { uid, gid, ruid: uid, euid: uid, suid: uid, rgid: gid, egid: gid, sgid: gid, groups: [...cred.groups] };
};

export type Kind = "file" | "dir" | "link" | "char";
export type Rfn = (n: number) => Uint8Array;
export type Wfn = (b: Uint8Array) => number;

export const credUid = (cred: Cred): number => cred.uid;
export const credGid = (cred: Cred): number => cred.gid;

export interface St {
  ino: number;
  kind: Kind;
  mode: number;
  uid: number;
  gid: number;
  nlink: number;
  size: number;
  at: number;
  mt: number;
  ct: number;
}

export interface Hit { node: VNode; path: string }
export interface CharOptions { mode: number; repeat: boolean }

interface Parent { readonly directory: HostInode; readonly name: string }

const OPEN_WRITE = 1, OPEN_CREATE = 0x40, OPEN_EXCLUSIVE = 0x80;

/** A host syscall facade over the one mounted native filesystem. */
export class Vfs {
  private readonly volume: RootVolume;

  constructor(readonly authority: HostProcess, readonly cap: number) {
    this.volume = new RootVolume(authority, cap);
  }

  get root(): Dir {
    const root = this.at("/", this.authority).node;
    return root instanceof Dir ? root : bad("EIO", "root is not a directory");
  }

  private view(inode: HostInode, process: HostProcess): VNode {
    return nodeView(inode, process, this.volume.backing);
  }

  at(path: string, process: HostProcess, follow = true): Hit {
    this.volume.checkProcess(process);
    const inode = HostInode.resolve(process, path, follow);
    return { node: this.view(inode, process), path: absolutePath(path, this.volume.cwd(process)) };
  }

  need(node: VNode, process: HostProcess, bits: number): void { node.view.need(process, bits); }

  private parent(path: string, process: HostProcess): Parent {
    this.volume.checkProcess(process);
    const { parent, name } = splitParent(path);
    return { directory: HostInode.resolve(process, parent), name };
  }

  /** The trusted executable loader checks execute permission before accessing bytes. */
  executable(path: string, process: HostProcess): Reg {
    const node = this.at(path, process).node;
    if (!(node instanceof Reg)) return bad("ENOEXEC", path);
    node.view.need(process, 1);
    return new Reg(node.view, this.authority, this.volume.backing);
  }

  readb(path: string, process: HostProcess): Uint8Array {
    const node = this.at(path, process).node;
    if (node instanceof Reg) return node.data;
    if (!(node instanceof Chr)) return bad(node instanceof Dir ? "EISDIR" : "EINVAL", path);
    const descriptor = HostDescriptor.open(process, node.view, 1);
    try { return descriptor.readFile(65536); }
    finally { descriptor.close(); }
  }

  read(path: string, process: HostProcess): string { return dec(this.readb(path, process)); }

  /** Replace/append through a canonical open, including write-only files. */
  writeb(path: string, bytes: Uint8Array, process: HostProcess, add = false, mode = 0o666): void {
    let existing: VNode | null = null;
    try { existing = this.at(path, process).node; }
    catch (error) {
      if (!(error instanceof KErr) || error.code !== "ENOENT") throw error instanceof Error ? error : new Error("filesystem resolution failed");
    }
    if (existing === null) { this.createFile(path, bytes, process, mode, false); return; }
    if (existing instanceof Dir) bad("EISDIR", path);
    const descriptor = HostDescriptor.open(process, existing.view, add ? 6 : 2);
    try {
      if (add || existing instanceof Chr) descriptor.writeWhole(bytes);
      else descriptor.replaceFile(bytes);
    } finally { descriptor.close(); }
  }

  write(path: string, data: string, process: HostProcess, add = false, mode = 0o666): void {
    this.writeb(path, enc(data), process, add, mode);
  }

  private createFile(path: string, data: Uint8Array, process: HostProcess, mode: number, exclusive: boolean): Reg {
    this.volume.checkProcess(process);
    const flags = OPEN_WRITE | OPEN_CREATE | (exclusive ? OPEN_EXCLUSIVE : 0);
    const descriptor = HostDescriptor.openPath(process, path, flags, mode);
    const inode = descriptor.inodeView() ?? bad("EIO", "file creation has no inode");
    try {
      const originalMode = inode.metadata().mode;
      descriptor.replaceFile(data);
      if ((originalMode & 0o6000) !== 0) inode.chmod(process, originalMode);
    } catch (error) {
      if (exclusive) this.rm(path, process);
      throw error instanceof Error ? error : new Error("file creation failed");
    } finally { descriptor.close(); }
    return new Reg(inode, process, this.volume.backing);
  }

  mkfile(path: string, data: Uint8Array | string, process: HostProcess, mode = 0o644): Reg {
    return this.createFile(path, typeof data === "string" ? enc(data) : data, process, mode, true);
  }

  mkdir(path: string, process: HostProcess, mode = 0o755): Dir {
    const { directory, name } = this.parent(path, process);
    return new Dir(directory.create(process, name, 2, mode), process, this.volume.backing);
  }

  char(path: string, read: Rfn, write: Wfn, process: HostProcess, options: CharOptions = { mode: 0o666, repeat: false }): Chr {
    if (process !== this.authority) bad("EPERM", "device creation requires the trusted root authority");
    const { directory, name } = this.parent(path, process);
    const inode = directory.create(process, name, 4, options.mode);
    this.volume.device(inode, { read, write, repeat: options.repeat });
    return new Chr(inode, process, this.volume.backing);
  }

  list(path: string, process: HostProcess): Array<[string, VNode]> {
    const node = this.at(path, process).node;
    if (!(node instanceof Dir)) return bad("ENOTDIR", path);
    node.view.need(process, 5);
    return [...node.ent].sort(([left], [right]) => left.localeCompare(right));
  }

  rm(path: string, process: HostProcess, dir = false): void {
    const { directory, name } = this.parent(path, process);
    directory.unlink(process, name, dir);
    this.volume.backing.collect();
  }

  rename(from: string, to: string, process: HostProcess): void {
    const source = this.parent(from, process), destination = this.parent(to, process);
    source.directory.rename(process, source.name, destination.directory, destination.name);
    this.volume.backing.collect();
  }

  link(from: string, to: string, process: HostProcess): void {
    const { directory, name } = this.parent(to, process), inode = HostInode.resolve(process, from);
    directory.link(process, name, inode);
  }

  symlink(target: string, path: string, process: HostProcess): void {
    const { directory, name } = this.parent(path, process);
    directory.symlink(process, name, target);
  }

  readlink(path: string, process: HostProcess): string {
    const node = this.at(path, process, false).node;
    return node instanceof Sym ? node.to : bad("EINVAL", path);
  }

  chmod(path: string, mode: number, process: HostProcess): void { this.at(path, process, false).node.view.chmod(process, mode); }
  chown(path: string, uid: number, gid: number, process: HostProcess): void { this.at(path, process, false).node.view.chown(process, uid, gid); }
  utime(path: string, at: number, mt: number, process: HostProcess, follow = true): void {
    this.at(path, process, follow).node.view.utime(process, BigInt(at), BigInt(mt));
  }

  stat(path: string, process: HostProcess, follow = true): St { return statView(this.at(path, process, follow).node.view); }

  paths(path: string, process: HostProcess): string[] {
    const hit = this.at(path, process), out: string[] = [];
    const visit = (node: VNode, base: string): void => {
      out.push(base);
      if (!(node instanceof Dir)) return;
      node.view.need(process, 5);
      for (const [name, child] of node.ent) visit(child, base === "/" ? "/" + name : base + "/" + name);
    };
    visit(hit.node, hit.path);
    return out;
  }

  glob(pattern: string, process: HostProcess): string[] {
    if (!wild(pattern)) return [pattern];
    const cwd = this.volume.cwd(process), absolute = norm(pattern, cwd);
    const root = absolute.slice(0, Math.max(1, absolute.search(/[*?]|\[[^\]]+\]/)));
    const base = root.slice(0, root.lastIndexOf("/")) || "/", rx = wrx(absolute);
    const prefix = cwd === "/" ? "/" : cwd + "/";
    try { return this.paths(base, process).filter(path => rx.test(path)).map(path => pattern.startsWith("/") || !path.startsWith(prefix) ? path : path.slice(prefix.length)); }
    catch (error) { if (error instanceof KErr) return []; throw error instanceof Error ? error : new Error("glob failed"); }
  }

  used(): number { return this.volume.used(); }
  inodeCount(): number { return this.volume.inodeCount(); }
  dump(): TreeEnt[] { return this.volume.dump(); }
  restore(entries: readonly TreeEnt[]): void { this.volume.restore(entries); }
}
