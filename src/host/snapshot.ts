import { bad } from "../core/err.js";
import type { TreeEnt } from "../fs/tree.js";
import { dec } from "../io/stream.js";
import { fileSum } from "./bytes.js";
import type { HostBacking } from "./backing.js";
import { readDirectory } from "./directory.js";
import { HostInode, inodeKind } from "./inode.js";
import type { HostProcess } from "./process.js";

const safeSize = (size: bigint): number => {
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) bad("EFBIG", "inode metadata exceeds persistence format");
  return Number(size);
};

/** Read an arena payload in bounded leases, without allocating a second kernel tree. */
const arenaBytes = (view: HostInode, process: HostProcess, size: number): Uint8Array => {
  const result = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const bytes = view.read(process, BigInt(offset), Math.min(65536, size - offset));
    if (bytes.length === 0) bad("EAGAIN", "inode changed during snapshot");
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
};

const describe = (view: HostInode, process: HostProcess, backing: HostBacking, path: string, id: number): TreeEnt | null => {
  const meta = view.metadata();
  const kind = inodeKind(meta.kind);
  if (kind === "c") return null;
  const entry: TreeEnt = { p: path, k: kind, id, mode: meta.mode, uid: meta.uid, gid: meta.gid,
    at: safeSize(meta.at), mt: safeSize(meta.mt), ct: safeSize(meta.ct), data: null, sum: null, size: null, source: null, to: null };
  if (kind === "l") entry.to = dec(arenaBytes(view, process, safeSize(meta.size)));
  if (kind !== "f") return entry;
  entry.size = safeSize(meta.size);
  const payload = backing.snapshot(view, process) ?? arenaBytes(view, process, entry.size);
  if (payload instanceof Uint8Array) {
    entry.data = payload;
    entry.sum = fileSum(payload);
  } else {
    entry.source = payload;
    entry.sum = payload.sum;
  }
  return entry;
};

/** Produce a persistence image from live canonical state; retry on concurrent mutation. */
export const dumpHostTree = (process: HostProcess, backing: HostBacking): TreeEnt[] => {
  const start = process.snapshotGeneration();
  const entries: TreeEnt[] = [], seen = new Map<number, TreeEnt>();
  const walk = (view: HostInode, path: string): void => {
    const previous = seen.get(view.ino) ?? null;
    if (previous !== null && previous.k === "d") bad("EIO", "canonical directory has multiple parents");
    if (previous !== null) {
      entries.push({ ...previous, p: path });
      return;
    }
    const entry = describe(view, process, backing, path, seen.size + 1);
    if (entry === null) return;
    seen.set(view.ino, entry);
    entries.push(entry);
    if (entry.k !== "d") return;
    const children = readDirectory(view, process).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) walk(new HostInode(process.memory, child.inode), path === "/" ? "/" + child.name : path + "/" + child.name);
  };
  walk(HostInode.resolve(process, "/"), "/");
  if (process.snapshotGeneration() !== start) bad("EAGAIN", "filesystem changed during snapshot");
  return entries;
};
