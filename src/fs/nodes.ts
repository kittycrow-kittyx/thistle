import { bad } from "../core/err.js";
import { HostInode, inodeKind } from "../host/inode.js";
import type { HostProcess } from "../host/process.js";
import type { HostBacking } from "../host/backing.js";
import { readDirectory } from "../host/directory.js";
import { fileSum } from "../host/bytes.js";
import type { RegSource } from "../host/bytes.js";
import { dec } from "../io/stream.js";
import type { Kind, St } from "./vfs.js";

const names: Readonly<Record<"d" | "f" | "l" | "c", Kind>> = { d: "dir", f: "file", l: "link", c: "char" };
export const fileKind = (kind: number): Kind => names[inodeKind(kind)];

const safe = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) bad("EFBIG", "inode metadata exceeds host integer range");
  return Number(value);
};

/** Convert canonical metadata into a userspace stat record. */
export const statView = (view: HostInode): St => {
  const meta = view.metadata();
  return { ...meta, kind: fileKind(meta.kind), size: safe(meta.size), at: safe(meta.at), mt: safe(meta.mt), ct: safe(meta.ct) };
};

const arenaBytes = (view: HostInode, process: HostProcess): Uint8Array => {
  view.need(process, 4);
  const result = new Uint8Array(safe(view.metadata().size));
  let at = 0;
  while (at < result.length) {
    const bytes = view.read(process, BigInt(at), Math.min(65536, result.length - at));
    if (bytes.length === 0) bad("EAGAIN", "inode changed during read");
    result.set(bytes, at);
    at += bytes.length;
  }
  return result;
};

/** A non-owning view. All metadata is read from the live canonical inode. */
export abstract class VNode {
  abstract readonly kind: Kind;
  constructor(readonly view: HostInode, readonly process: HostProcess, readonly backing: HostBacking) {}
  get ino(): number { return this.view.ino; }
  get mode(): number { return this.view.metadata().mode; }
  get uid(): number { return this.view.metadata().uid; }
  get gid(): number { return this.view.metadata().gid; }
  get nlink(): number { return this.view.metadata().nlink; }
  get at(): number { return safe(this.view.metadata().at); }
  get mt(): number { return safe(this.view.metadata().mt); }
  get ct(): number { return safe(this.view.metadata().ct); }
}

export class Reg extends VNode {
  readonly kind = "file" as const;
  get size(): number { return safe(this.view.metadata().size); }

  private payload(): Uint8Array | RegSource {
    return this.backing.snapshot(this.view, this.process) ?? arenaBytes(this.view, this.process);
  }

  get data(): Uint8Array {
    const payload = this.payload();
    return payload instanceof Uint8Array ? payload : bad("EAGAIN", "lazy file requires materialisation");
  }

  get source(): RegSource | null {
    const payload = this.payload();
    return payload instanceof Uint8Array ? null : payload;
  }

  get sum(): string {
    const payload = this.payload();
    return payload instanceof Uint8Array ? fileSum(payload) : payload.sum;
  }

  get lazy(): boolean { return this.source !== null; }
  get residentSize(): number { return this.lazy ? 0 : this.size; }

  head(length: number): Uint8Array {
    const payload = this.payload();
    if (payload instanceof Uint8Array) return payload.slice(0, length);
    return (payload.head ?? new Uint8Array()).slice(0, length);
  }

  async materialise(): Promise<Uint8Array> {
    const payload = this.payload();
    return payload instanceof Uint8Array ? payload : this.backing.readView(this.view, this.process);
  }
}

export class Dir extends VNode {
  readonly kind = "dir" as const;

  /** Directory entries are a read-only snapshot, never a mutable namespace. */
  get ent(): ReadonlyMap<string, VNode> {
    const entries = readDirectory(this.view, this.process);
    return new Map(entries.map(item => [item.name, nodeView(new HostInode(this.view.memory, item.inode), this.process, this.backing)]));
  }
}

export class Sym extends VNode {
  readonly kind = "link" as const;
  get to(): string { return dec(arenaBytes(this.view, this.process)); }
}

export class Chr extends VNode {
  readonly kind = "char" as const;
}

/** Bind a typed view to an existing inode incarnation. */
export const nodeView = (view: HostInode, process: HostProcess, backing: HostBacking): VNode => {
  const kind = fileKind(view.metadata().kind);
  if (kind === "file") return new Reg(view, process, backing);
  if (kind === "dir") return new Dir(view, process, backing);
  if (kind === "link") return new Sym(view, process, backing);
  return new Chr(view, process, backing);
};

export const fmtMode = (n: Pick<VNode, "kind" | "mode">): string => {
  const k = n.kind === "dir" ? "d" : n.kind === "link" ? "l" : n.kind === "char" ? "c" : "-";
  const m = n.mode;
  const exec = (x: number, special: number, lo: string, hi: string): string => m & special ? m & x ? lo : hi : m & x ? "x" : "-";
  return k +
    (m & 0o400 ? "r" : "-") + (m & 0o200 ? "w" : "-") + exec(0o100, 0o4000, "s", "S") +
    (m & 0o040 ? "r" : "-") + (m & 0o020 ? "w" : "-") + exec(0o010, 0o2000, "s", "S") +
    (m & 0o004 ? "r" : "-") + (m & 0o002 ? "w" : "-") + exec(0o001, 0o1000, "t", "T");
};
