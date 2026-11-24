import { requireValue, bad } from "../core/err.js";

const seg = (p: string): string[] => p.split("/").filter(x => x && x !== ".");
export const wild = (p: string): boolean => /[*?]|\[[^\]]+\]/.test(p);

export const wrx = (p: string): RegExp => {
  let s = "^";
  for (let i = 0; i < p.length; i++) {
    const c = requireValue(p[i] ?? null, "p[i]");
    if (c === "*") { s += "[^/]*"; continue; }
    if (c === "?") { s += "[^/]"; continue; }
    const z = c === "[" ? p.indexOf("]", i + 1) : -1;
    if (z >= 0) {
      const x = p.slice(i + 1, z);
      s += "[" + (x.startsWith("!") ? "^" + x.slice(1) : x) + "]";
      i = z;
      continue;
    }
    s += c === "[" || /[.+^${}()|\\]/.test(c) ? "\\" + c : c;
  }
  return new RegExp(s + "$");
};

export const norm = (p: string, cwd = "/"): string => {
  const src = p.startsWith("/") ? seg(p) : [...seg(cwd), ...seg(p)];
  const out: string[] = [];
  for (const x of src) {
    if (x === "..") { out.pop(); continue; }
    if (x !== ".") out.push(x);
  }
  return `/${out.join("/")}`;
};

export interface ParentPath { readonly parent: string; readonly name: string }

/** Keep raw parent components so the kernel resolves symlinks before dot-dot. */
export const splitParent = (path: string): ParentPath => {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed) bad("EBUSY", path);
  const slash = trimmed.lastIndexOf("/");
  const parent = slash < 0 ? "." : trimmed.slice(0, slash) || "/";
  return { parent, name: trimmed.slice(slash + 1) };
};

/** Return an absolute spelling without changing traversal semantics. */
export const absolutePath = (path: string, cwd: string): string =>
  path.startsWith("/") ? path : (cwd === "/" ? "/" : cwd + "/") + path;
