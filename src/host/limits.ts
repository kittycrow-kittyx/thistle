import { THISTLE_KERNEL_MEMORY_MIB } from "../core/kernel-memory.js";
import { Lim } from "../core/cap.js";

const MB = 1024 * 1024;
const GB = 1024 * MB;

interface MemoryNavigator extends Navigator { deviceMemory: number | null }

// Browser hardware hints and Node host capabilities have different lifetimes.
const nodeRam = (): number | null => {
  if (typeof process === "undefined") return null;
  const builtin = process.getBuiltinModule ?? null;
  if (builtin === null) return null;
  const os = process.getBuiltinModule("node:os") ?? null;
  return os === null ? null : os.totalmem();
};

const ram = (): number => {
  const browser = typeof navigator === "undefined" ? null : navigator as MemoryNavigator;
  const web = browser === null ? null : browser.deviceMemory ?? null;
  if (web !== null && web > 0 && Number.isFinite(web)) return web * GB;
  try {
    const n = nodeRam();
    if (n !== null && n > 0 && Number.isFinite(n)) return n;
  } catch {
    // Restricted hosts can reject access to the optional OS module.
    return 2 * GB;
  }
  return 2 * GB;
};

const env = (k: string, d: number, zero = false): number => {
  const s = typeof process === "undefined" ? null : process.env[k] ?? null;
  if (s === null || s === "") return d;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || (!zero && !n)) throw new Error(`${k} must be ${zero ? "a non-negative" : "a positive"} integer`);
  return n;
};

/** Discover resource ceilings at the JavaScript host boundary. */
export function hostLimits(): Lim {
  const r = ram();
  // Capacity is sparse: a generous ceiling costs nothing until a program uses it.
  const fs = env("THISTLE_FS_MB", Math.max(2048, Math.min(65536, Math.floor(r / MB / 2)))) * MB;
  const mem = env("THISTLE_MEM_MB", Math.max(THISTLE_KERNEL_MEMORY_MIB, Math.min(32768, Math.floor(r / MB / 2)))) * MB;
  const stack = env("THISTLE_STACK_MB", Math.max(32, Math.min(1024, Math.floor(mem / MB / 8)))) * MB;
  const fuel = env("THISTLE_FUEL", 10_000_000_000, true);
  return new Lim(fs, mem, stack, fuel);
}
