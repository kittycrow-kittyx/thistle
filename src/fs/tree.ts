import { bad } from "../core/err.js";
import { fileSum } from "../host/bytes.js";
import { Chr, Dir, Reg, Sym, Vfs } from "./vfs.js";
import type { RegSource, VNode } from "./vfs.js";

export interface TreeEnt {
  p: string;
  k: "d" | "f" | "l";
  id: number;
  mode: number;
  uid: number;
  gid: number;
  at: number;
  mt: number;
  ct: number;
  data: Uint8Array | null;
  sum: string | null;
  size: number | null;
  source: RegSource | null;
  to: string | null;
}

export interface Tree {
  readonly label: string;
  readonly imageVersion: number | null;
  pull(): Promise<TreeEnt[] | null>;
  push(ent: TreeEnt[], imageVersion: number | null): Promise<TreeEnt[] | void>;
}

const root = { uid: 0, gid: 0, groups: [0] };

export { fileSum } from "../host/bytes.js";

const assignRegularPayload = (entry: TreeEnt, node: Reg): void => {
  if (node.lazy && node.source !== null) { entry.source = node.source; return; }
  entry.data = node.data;
};

const applyFileSum = (node: VNode, entry: TreeEnt): void => {
  const sum = entry.sum ?? null;
  if (node instanceof Reg && sum !== null) node.sum = sum;
};

const checkFilePayload = (e: TreeEnt): void => {
    const source = e.source ?? null;
    const sum = e.sum ?? null;
    const size = e.size ?? null;
    const hasData = e.data instanceof Uint8Array;
    const hasSource = source !== null && Number.isSafeInteger(source.size) && source.size >= 0 && typeof source.sum === "string" && typeof source.load === "function";
    if (!hasData && !hasSource || sum !== null && typeof sum !== "string" || size !== null && (!Number.isSafeInteger(size) || size < 0)) throw new Error("bad host tree payload");
};

const dumpTree = (fs: Vfs, mount = "/"): TreeEnt[] => {
    const h = fs.at(mount, "/", root), base = h.node instanceof Dir ? h.node : bad("ENOTDIR", mount), out: TreeEnt[] = [], ids = new Map<number, number>();
    let seq = 1;
    const go = (n: VNode, p: string): void => {
      if (n instanceof Chr) return;
      let id = ids.get(n.ino) ?? null; if (!id) { id = seq++; ids.set(n.ino, id); }
      const e: TreeEnt = { p, k: n instanceof Dir ? "d" : n instanceof Reg ? "f" : "l", id, mode: n.mode, uid: n.uid, gid: n.gid, at: n.at, mt: n.mt, ct: n.ct, data: null, sum: null, size: null, source: null, to: null };
      if (n instanceof Reg) {
        e.sum = n.sum ?? (n.source === null ? (n.sum = fileSum(n.data)) : n.source.sum);
        e.size = n.size;
        assignRegularPayload(e, n);
      }
      if (n instanceof Sym) e.to = n.to;
      out.push(e);
      if (n instanceof Dir) for (const [name, x] of [...n.ent].sort(([a], [b]) => a.localeCompare(b))) go(x, p === "/" ? `/${name}` : `${p}/${name}`);
    };
    go(base, "/");
    return out;
};

export class TreeFs {
  readonly dump = dumpTree;

  load(fs: Vfs, ent: TreeEnt[], mount = "/"): void {
    const h = fs.at(mount, "/", root), base = h.node instanceof Dir ? h.node : bad("ENOTDIR", mount);
    for (const e of ent) this.chk(e);
    base.ent.clear();
    const ids = new Map<number, VNode>(), defs = new Map<number, TreeEnt>();
    for (const e of ent) if (!defs.has(e.id) || (e.data ?? null) !== null || (e.to ?? null) !== null) defs.set(e.id, e);
    for (const e of [...ent].sort((a, b) => a.p.split("/").length - b.p.split("/").length)) {
      if (e.p === "/") { this.attr(base, e); ids.set(e.id, base); continue; }
      const [d, name] = this.par(base, e.p);
      let n = ids.get(e.id) ?? null;
      if (!n) {
        const q = defs.get(e.id) ?? e;
        n = e.k === "d"
          ? new Dir()
          : e.k === "f"
            ? new Reg(q.data ?? new Uint8Array(), { mode: 0o644, uid: 0, gid: 0, source: q.source ?? null, copy: false })
            : new Sym(q.to ?? "");
        applyFileSum(n, q);
        n.nlink = 0; ids.set(e.id, n); this.attr(n, e);
      }
      d.ent.set(name, n); n.nlink++;
    }
    if (fs.used() > fs.cap) throw new Error(`${mount} exceeds this host's VFS budget`);
  }

  private par(root: Dir, p: string): [Dir, string] {
    const a = p.split("/").filter(Boolean), name = a.pop() ?? null;
    if (!name) throw new Error("bad host tree path");
    let d = root;
    for (const x of a) {
      const n = d.ent.get(x) ?? null, q = n instanceof Dir ? n : new Dir();
      if (q !== n) d.ent.set(x, q);
      d = q;
    }
    return [d, name];
  }

  private attr(n: VNode, e: TreeEnt): void { n.mode = e.mode; n.uid = e.uid; n.gid = e.gid; n.at = e.at; n.mt = e.mt; n.ct = e.ct; }

  private chk(e: TreeEnt): void {
    if (!e || typeof e.p !== "string" || !e.p.startsWith("/") || e.p.split("/").includes("..") || !["d", "f", "l"].includes(e.k) || !Number.isSafeInteger(e.id) || e.id < 1) throw new Error("bad host tree entry");
    for (const n of [e.mode, e.uid, e.gid, e.at, e.mt, e.ct]) if (!Number.isSafeInteger(n) || n < 0) throw new Error("bad host tree metadata");
    if (e.k === "f") checkFilePayload(e);
    if (e.k === "l" && typeof e.to !== "string") throw new Error("bad host tree payload");
  }
}

export const treeFs = new TreeFs();
