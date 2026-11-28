import { bad } from "../core/err.js";
import type { RegSource, Vfs } from "./vfs.js";

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

export { fileSum } from "../host/bytes.js";

/** Root persistence delegates to the canonical image loader and serialiser. */
export class TreeFs {
  dump(fs: Vfs, mount = "/"): TreeEnt[] {
    if (mount !== "/") bad("ENOTSUP", "subtree persistence requires an explicit mount");
    return fs.dump();
  }

  load(fs: Vfs, entries: TreeEnt[], mount = "/"): void {
    if (mount !== "/") bad("ENOTSUP", "subtree persistence requires an explicit mount");
    fs.restore(entries);
  }
}

export const treeFs = new TreeFs();
