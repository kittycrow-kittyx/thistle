import { ensure } from "../core/err.js";
import { requireValue } from "../core/err.js";
import type { TreeEnt } from "../fs/tree.js";
import {
  THISTLE_VFS_DATA_CAPACITY,
  THISTLE_VFS_DENTRY_CAPACITY,
  THISTLE_VFS_IMAGE_MAGIC,
  THISTLE_VFS_IMAGE_VERSION,
  THISTLE_VFS_INODE_CAPACITY,
  THISTLE_VFS_KIND_DIRECTORY,
  THISTLE_VFS_KIND_FILE,
  THISTLE_VFS_KIND_LINK,
} from "../native/abi.js";

const HEADER_SIZE = 32;
const INODE_RECORD_SIZE = 56;
const DENTRY_RECORD_SIZE = 16;
const encoder = new TextEncoder();

interface InodeImage {
  entry: TreeEnt;
  payload: Uint8Array;
  nlink: number;
}

const align4 = (value: number): number => (value + 3) & ~3;

const checkedU32 = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`invalid Thistle VFS ${label}`);
  return value;
};

const checkedTime = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid Thistle VFS ${label}`);
  return value;
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((value, index) => value === (right[index] ?? null));

const kind = (entry: TreeEnt): number => {
  if (entry.k === "f") return THISTLE_VFS_KIND_FILE;
  if (entry.k === "d") return THISTLE_VFS_KIND_DIRECTORY;
  if (entry.k === "l") return THISTLE_VFS_KIND_LINK;
  throw new Error(`unsupported Thistle VFS node kind at ${entry.p}`);
};

const filePayload = (entry: TreeEnt, hostFiles: boolean): Uint8Array => {
  if (entry.data instanceof Uint8Array) return entry.data;
  const source = entry.source;
  ensure(hostFiles && source !== null && Number.isSafeInteger(source.size) && source.size >= 0 &&
    typeof source.sum === "string" && typeof source.load === "function",
  () => { throw new Error(`missing Thistle VFS file data at ${entry.p}`); });
  return new Uint8Array();
};

const payload = (entry: TreeEnt, hostFiles: boolean): Uint8Array => {
  if (entry.k === "f") return filePayload(entry, hostFiles);
  if (entry.k === "l") {
    ensure(!(typeof entry.to !== "string"), () => { throw new Error(`missing Thistle VFS link target at ${entry.p}`); });
    return encoder.encode(entry.to);
  }
  return new Uint8Array();
};

const validPath = (path: string): boolean => {
  if (path === "/") return true;
  if (!path.startsWith("/") || path.endsWith("/") || path.includes("//")) return false;
  return path.slice(1).split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.includes("\0"));
};

const parentPath = (path: string): string => {
  const split = path.lastIndexOf("/");
  return split === 0 ? "/" : path.slice(0, split);
};

const fnv = (bytes: Uint8Array, from: number): number => {
  let hash = 0x811c9dc5;
  for (let index = from; index < bytes.length; index++) hash = Math.imul(hash ^ requireValue(bytes[index] ?? null, "src/thistle/vfs-host.ts:71"), 0x01000193);
  return hash >>> 0;
};

/** Validate path ownership and hard-link identity before sizing the image. */
const indexInodes = (entries: VfsEntries, paths: Map<string, TreeEnt>, hostFiles: boolean): InodeImage[] => {
  // Every alias must agree on metadata and payload before a binary record is written.
  const links = new Map<number, number>();
  const inodes = new Map<number, InodeImage>();

  for (const entry of entries) {
    if (!validPath(entry.p) || paths.has(entry.p)) throw new Error(`invalid or duplicate Thistle VFS path ${entry.p}`);
    checkedU32(entry.id, `inode at ${entry.p}`);
    if (entry.id === 0 || entry.id >= THISTLE_VFS_INODE_CAPACITY) throw new Error(`Thistle VFS inode is outside the kernel table at ${entry.p}`);
    checkedU32(entry.mode, `mode at ${entry.p}`);
    checkedU32(entry.uid, `uid at ${entry.p}`);
    checkedU32(entry.gid, `gid at ${entry.p}`);
    checkedTime(entry.at, `atime at ${entry.p}`);
    checkedTime(entry.mt, `mtime at ${entry.p}`);
    checkedTime(entry.ct, `ctime at ${entry.p}`);
    const bytes = payload(entry, hostFiles);
    const logicalSize = entry.data === null && entry.source !== null ? entry.source.size : bytes.length;
    if (entry.k === "f" && entry.size !== null && entry.size !== logicalSize) throw new Error(`inconsistent Thistle VFS file size at ${entry.p}`);
    const previous = (inodes.get(entry.id) ?? null);
    if (previous) {
      const original = previous.entry;
      const sameSource = original.source === entry.source || original.source !== null && entry.source !== null &&
        original.source.sum !== "" && original.source.sum === entry.source.sum && original.source.size === entry.source.size;
      ensure(!(hostFiles && entry.k === "f" && !sameSource), () => { throw new Error(`inconsistent Thistle VFS hard-link source at ${entry.p}`); });
      ensure(!(original.k !== entry.k || original.mode !== entry.mode || original.uid !== entry.uid || original.gid !== entry.gid ||
          original.at !== entry.at || original.mt !== entry.mt || original.ct !== entry.ct || !sameBytes(previous.payload, bytes)), () => { throw new Error(`inconsistent Thistle VFS hard-link metadata at ${entry.p}`); });
    } else {
      inodes.set(entry.id, { entry, payload: bytes, nlink: 0 });
    }
    paths.set(entry.p, entry);
    links.set(entry.id, (links.get(entry.id) ?? 0) + 1);
  }

  const result = [...inodes.values()].sort((left, right) => left.entry.id - right.entry.id);
  for (const inode of result) {
    inode.nlink = links.get(inode.entry.id) ?? 0;
    if (inode.entry.k === "d" && inode.nlink !== 1) throw new Error(`Thistle VFS directory has multiple parents at ${inode.entry.p}`);
  }
  return result;
};

/** Encode only inode records, leaving the caller at the dentry table. */
const writeInodes = (output: Uint8Array, inodes: readonly InodeImage[], hostFiles: boolean): number => {
  const view = new DataView(output.buffer);
  let at = HEADER_SIZE;
  for (const inode of inodes) {
    const entry = inode.entry;
    const stored = hostFiles && entry.k === "f" ? new Uint8Array() : inode.payload;
    view.setUint32(at, entry.id, true);
    view.setUint32(at + 4, kind(entry), true);
    view.setUint32(at + 8, entry.mode, true);
    view.setUint32(at + 12, entry.uid, true);
    view.setUint32(at + 16, entry.gid, true);
    view.setUint32(at + 20, inode.nlink, true);
    view.setUint32(at + 24, stored.length, true);
    view.setBigUint64(at + 32, BigInt(entry.at), true);
    view.setBigUint64(at + 40, BigInt(entry.mt), true);
    view.setBigUint64(at + 48, BigInt(entry.ct), true);
    output.set(stored, at + INODE_RECORD_SIZE);
    at += align4(INODE_RECORD_SIZE + stored.length);
  }
  return at;
};

interface DentryImage { entry: TreeEnt; parent: TreeEnt; name: Uint8Array; }

const indexDentries = (entries: VfsEntries, paths: Map<string, TreeEnt>): DentryImage[] => {
  return entries.filter(entry => entry.p !== "/").map(entry => {
    const parent = (paths.get(parentPath(entry.p)) ?? null);
    if (!parent || parent.k !== "d") throw new Error(`missing Thistle VFS parent directory for ${entry.p}`);
    const name = encoder.encode(entry.p.slice(entry.p.lastIndexOf("/") + 1));
    if (name.length === 0 || name.length > 255 || name.some(value => value === 0 || value === 47)) {
      throw new Error(`invalid Thistle VFS name at ${entry.p}`);
    }
    return { entry, parent, name };
  });
};

/** Append directory records after the inode payload region. */
const writeDentries = (output: Uint8Array, dentries: readonly DentryImage[], offset: number): number => {
  const view = new DataView(output.buffer);
  let at = offset;
  for (const dentry of dentries) {
    view.setUint32(at, dentry.parent.id, true);
    view.setUint32(at + 4, dentry.entry.id, true);
    view.setUint32(at + 8, dentry.name.length, true);
    output.set(dentry.name, at + DENTRY_RECORD_SIZE);
    at += align4(DENTRY_RECORD_SIZE + dentry.name.length);
  }
  return at;
};

/** Static tree entries accepted by the canonical image serializer. */
export type VfsEntries = readonly TreeEnt[];

export interface HostVfsImage {
  readonly image: Uint8Array;
  readonly files: VfsEntries;
  readonly residentBytes: bigint;
}

const planImage = (source: VfsEntries, hostFiles: boolean): HostVfsImage => {
  // Validate the complete topology before sizing or writing any native image records.
  const entries = [...source].sort((left, right) => left.p < right.p ? -1 : left.p > right.p ? 1 : 0);
  const paths = new Map<string, TreeEnt>();
  const inodeImages = indexInodes(entries, paths, hostFiles);

  const root = (paths.get("/") ?? null);
  if (!root || root.k !== "d") throw new Error("Thistle VFS image requires one directory root");
  if (inodeImages.length === 0 || inodeImages.length >= THISTLE_VFS_INODE_CAPACITY) throw new Error("Thistle VFS inode table is full");
  if (entries.length - 1 > THISTLE_VFS_DENTRY_CAPACITY) throw new Error("Thistle VFS dentry table is full");

  let imageSize = HEADER_SIZE;
  let dataSize = 0;
  let residentBytes = BigInt(inodeImages.length) * 128n;
  for (const inode of inodeImages) {
    const storedLength = hostFiles && inode.entry.k === "f" ? 0 : inode.payload.length;
    imageSize += align4(INODE_RECORD_SIZE + storedLength);
    dataSize += align4(storedLength);
    if (inode.entry.k === "f") residentBytes += BigInt(inode.payload.length);
  }

  const dentries = indexDentries(entries, paths);
  for (const { name } of dentries) {
    imageSize += align4(DENTRY_RECORD_SIZE + name.length);
    dataSize += align4(name.length);
  }
  if (dataSize > THISTLE_VFS_DATA_CAPACITY || imageSize > 0xffffffff) throw new Error("Thistle VFS image exceeds the kernel data arena");

  const output = new Uint8Array(imageSize);
  const view = new DataView(output.buffer);
  view.setUint32(0, THISTLE_VFS_IMAGE_MAGIC, true);
  view.setUint32(4, THISTLE_VFS_IMAGE_VERSION, true);
  view.setUint32(8, inodeImages.length, true);
  view.setUint32(12, dentries.length, true);
  view.setUint32(16, root.id, true);
  view.setUint32(20, output.length, true);
  let at = writeInodes(output, inodeImages, hostFiles);
  at = writeDentries(output, dentries, at);
  if (at !== output.length) throw new Error("Thistle VFS serializer size mismatch");
  view.setUint32(24, fnv(output, HEADER_SIZE), true);
  return { image: output, files: inodeImages.filter(inode => inode.entry.k === "f").map(inode => inode.entry), residentBytes };
};

/** Produce the existing native image format with resident file data. */
export const serializeThistleVfs = (source: VfsEntries): Uint8Array => planImage(source, false).image;

/** Plan a host mount using the same topology and metadata validation as native images. */
export const planHostThistleVfs = (source: VfsEntries): HostVfsImage => planImage(source, true);
