import { bad } from "../core/err.js";

export const PG = 65536;

export interface RvMemory {
  readonly top: bigint;
  readonly cap: number;
  readonly used: number;
  read(at: bigint, n: number): Uint8Array;
  write(at: bigint, b: Uint8Array): void;
  drop(at: bigint, n: number): void;
  u8(at: bigint): number;
  i8(at: bigint): bigint;
  u16(at: bigint): number;
  i16(at: bigint): bigint;
  u32(at: bigint): number;
  i32(at: bigint): bigint;
  u64(at: bigint): bigint;
  i64(at: bigint): bigint;
  f32(at: bigint): number;
  f64(at: bigint): number;
  set8(at: bigint, n: bigint | number): void;
  set16(at: bigint, n: bigint | number): void;
  set32(at: bigint, n: bigint | number): void;
  set64(at: bigint, n: bigint | number): void;
  setF32(at: bigint, n: number): void;
  setF64(at: bigint, n: number): void;
}

export class Mem64 implements RvMemory {
  readonly page = new Map<number, Uint8Array>();
  used = 0;

  constructor(readonly top: bigint, readonly cap: number) {
    if (top < 1024n * 1024n || top > BigInt(Number.MAX_SAFE_INTEGER)) bad("ENOEXEC", "bad thistle64 virtual memory size");
    if (!Number.isSafeInteger(cap) || cap < PG) bad("ENOMEM", "bad thistle64 host memory budget");
  }

  read(at: bigint, n: number): Uint8Array {
    this.chk(at, n);
    const out = new Uint8Array(n);
    this.each(at, n, (p, off, len, dst) => { const q = this.page.get(p) ?? null; if (q) out.set(q.subarray(off, off + len), dst); });
    return out;
  }

  write(at: bigint, b: Uint8Array): void {
    this.chk(at, b.length);
    this.each(at, b.length, (p, off, len, src) => {
      const x = b.subarray(src, src + len);
      let q = this.page.get(p) ?? null;
      if (!q && x.some(v => v !== 0)) q = this.make(p);
      if (q) q.set(x, off);
    });
  }

  drop(at: bigint, n: number): void {
    this.chk(at, n);
    if (!n) return;
    const end = at + BigInt(n), first = Number(at / BigInt(PG)), last = Number((end - 1n) / BigInt(PG));
    for (let p = first; p <= last; p++) {
      const q = this.page.get(p) ?? null; if (!q) continue;
      const base = BigInt(p) * BigInt(PG), lo = Number(at > base ? at - base : 0n), hi = Number(end < base + BigInt(PG) ? end - base : BigInt(PG));
      if (!lo && hi === PG) { this.page.delete(p); this.used -= PG; }
      else q.fill(0, lo, hi);
    }
  }

  /** Direct page view for resident scalars; reads spanning pages retain sparse zero fill. */
  private scalarView(at: bigint, width: number): DataView | null {
    this.chk(at, width);
    const address = Number(at), offset = address % PG;
    if (offset + width > PG) {
      const bytes = this.read(at, width);
      return new DataView(bytes.buffer, bytes.byteOffset, width);
    }
    const page = this.page.get(Math.floor(address / PG)) ?? null;
    return page === null ? null : new DataView(page.buffer, page.byteOffset + offset, width);
  }

  u8(at: bigint): number {
    const view = this.scalarView(at, 1);
    return view === null ? 0 : view.getUint8(0);
  }
  i8(at: bigint): bigint {
    const view = this.scalarView(at, 1);
    return view === null ? 0n : BigInt(view.getInt8(0));
  }
  u16(at: bigint): number {
    const view = this.scalarView(at, 2);
    return view === null ? 0 : view.getUint16(0, true);
  }
  i16(at: bigint): bigint {
    const view = this.scalarView(at, 2);
    return view === null ? 0n : BigInt(view.getInt16(0, true));
  }
  u32(at: bigint): number {
    const view = this.scalarView(at, 4);
    return view === null ? 0 : view.getUint32(0, true);
  }
  i32(at: bigint): bigint {
    const view = this.scalarView(at, 4);
    return view === null ? 0n : BigInt(view.getInt32(0, true));
  }
  u64(at: bigint): bigint {
    const view = this.scalarView(at, 8);
    return view === null ? 0n : view.getBigUint64(0, true);
  }
  i64(at: bigint): bigint {
    const view = this.scalarView(at, 8);
    return view === null ? 0n : view.getBigInt64(0, true);
  }
  f32(at: bigint): number {
    const view = this.scalarView(at, 4);
    return view === null ? 0 : view.getFloat32(0, true);
  }
  f64(at: bigint): number {
    const view = this.scalarView(at, 8);
    return view === null ? 0 : view.getFloat64(0, true);
  }

  set8(at: bigint, n: bigint | number): void {
    this.chk(at, 1);
    const v = Number(BigInt.asUintN(8, BigInt(n))), p = Number(at), page = Math.floor(p / PG), off = p % PG;
    let q = this.page.get(page) ?? null; if (!q && v) q = this.make(page); if (q) q[off] = v;
  }
  set16(at: bigint, n: bigint | number): void { this.setN(at, BigInt(n), 2); }
  set32(at: bigint, n: bigint | number): void { this.setN(at, BigInt(n), 4); }
  set64(at: bigint, n: bigint | number): void { this.setN(at, BigInt(n), 8); }

  setF32(at: bigint, n: number): void {
    this.chk(at, 4);
    const p = Number(at), off = p % PG;
    if (off > PG - 4) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n, true); this.write(at, b); return; }
    const page = Math.floor(p / PG); let q = this.page.get(page) ?? null; if (!q && (n !== 0 || Object.is(n, -0))) q = this.make(page);
    if (q) new DataView(q.buffer, q.byteOffset + off, 4).setFloat32(0, n, true);
  }

  setF64(at: bigint, n: number): void {
    this.chk(at, 8);
    const p = Number(at), off = p % PG;
    if (off > PG - 8) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); this.write(at, b); return; }
    const page = Math.floor(p / PG); let q = this.page.get(page) ?? null; if (!q && (n !== 0 || Object.is(n, -0))) q = this.make(page);
    if (q) new DataView(q.buffer, q.byteOffset + off, 8).setFloat64(0, n, true);
  }

  private setN(at: bigint, n: bigint, z: number): void {
    this.chk(at, z);
    const p = Number(at), off = p % PG, x = BigInt.asUintN(z * 8, n);
    if (off > PG - z) { const b = new Uint8Array(z); for (let i = 0; i < z; i++) b[i] = Number(x >> BigInt(i * 8) & 255n); this.write(at, b); return; }
    const page = Math.floor(p / PG); let q = this.page.get(page) ?? null; if (!q && x) q = this.make(page);
    if (q) for (let i = 0; i < z; i++) q[off + i] = Number(x >> BigInt(i * 8) & 255n);
  }

  private chk(at: bigint, n: number): void {
    if (at < 0n || !Number.isSafeInteger(n) || n < 0 || at + BigInt(n) > this.top) bad("ERANGE", `thistle64 address 0x${at.toString(16)}`);
  }

  private each(at: bigint, n: number, fn: (page: number, off: number, len: number, pos: number) => void): void {
    let p = 0;
    while (p < n) {
      const q = at + BigInt(p), page = Number(q / BigInt(PG)), off = Number(q % BigInt(PG)), len = Math.min(n - p, PG - off);
      fn(page, off, len, p);
      p += len;
    }
  }

  private make(n: number): Uint8Array {
    if (this.used + PG > this.cap) bad("ENOMEM", `thistle64 touched-page budget ${this.cap} bytes exhausted`);
    const p = new Uint8Array(PG);
    this.page.set(n, p);
    this.used += PG;
    return p;
  }
}

export function hostNumber(value: bigint, context: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) bad("ERANGE", `${context} is out of range`);
  return Number(value);
}

/** Fill writable guest memory in chunks accepted by the host random source. */
export function randomFill(memory: RvMemory, check: (at: bigint, size: number, write: boolean) => void, at: bigint, size: number): number {
  check(at, size, true);
  for (let offset = 0; offset < size; offset += 65536) {
    const bytes = new Uint8Array(Math.min(65536, size - offset));
    crypto.getRandomValues(bytes);
    memory.write(at + BigInt(offset), bytes);
  }
  return size;
}

/** Read one bounded, zero-terminated guest string through the active mapping checks. */
export function readString(memory: RvMemory, check: (at: bigint, size: number) => void, address: bigint, context: string): string {
  const bytes: number[] = [];
  let at = BigInt.asUintN(64, address);
  for (; bytes.length < 65536; at++) {
    check(at, 1);
    const byte = memory.u8(at);
    if (byte === 0) return new TextDecoder().decode(Uint8Array.from(bytes));
    bytes.push(byte);
  }
  return bad("ENAMETOOLONG", context);
}
