import { requireValue } from "../core/err.js";
import { bad } from "../core/err.js";
import type { RvMemory } from "../vm/mem64.js";
import { P_PAGE_COUNT, P_PAGE_TABLE, P_PAGE_CAPACITY, P_PID, THISTLE_GUEST_PAGE_SIZE, THISTLE_PAGE_ENTRY_SIZE, PAGE_DIRTY_FRAME } from "../native/abi.js";
import { thistleGuestPage, thistleMarkGuestWrite } from "../native/kernel.js";
import { clearDirtyBytes } from "./arena.js";
import { checkNative } from "../host/native-access.js";
import type { DirtyWrite } from "../host/bytes.js";
import { processForHart, INVALID_POINTER } from "./state.js";
import { loadU32, loadU64 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";

const INVALID = 0xffffffff;
const UNMAPPED = 0xfffffffe;
export type ThistlePageLookup = (hart: number, address: bigint, create: boolean) => number;

interface DirtySpan {
  readonly entry: number;
  readonly offset: number;
  readonly length: number;
  readonly at: bigint;
}

const dirtyBit = (memory: ThistleMemory, frame: number, offset: number): boolean =>
  (loadU32(memory, frame + (offset >>> 5) * 4) & (1 << (offset & 31))) !== 0;

const pageDirtySpans = (memory: ThistleMemory, entry: number, at: bigint, end: bigint): DirtySpan[] => {
  const bitmap = loadU32(memory, entry + PAGE_DIRTY_FRAME), key = loadU64(memory, entry);
  if (bitmap === 0 || key === 0n) return [];
  const base = (key - 1n) << 16n, stop = base + BigInt(THISTLE_GUEST_PAGE_SIZE);
  if (at >= stop || end <= base) return [];
  const low = Number((at > base ? at : base) - base), high = Number((end < stop ? end : stop) - base);
  const result: DirtySpan[] = [];
  let cursor = low;
  while (cursor < high) {
    const bits = loadU32(memory, bitmap + (cursor >>> 5) * 4);
    if (bits === 0) { cursor = Math.min(high, (cursor & ~31) + 32); continue; }
    if ((bits & (1 << (cursor & 31))) === 0) { cursor++; continue; }
    let next = cursor + 1;
    while (next < high && dirtyBit(memory, bitmap, next)) next++;
    result.push({ entry, offset: cursor, length: next - cursor, at: base + BigInt(cursor) });
    cursor = next;
  }
  return result;
};

/** Direct-Thistle view of the sparse memory representation also generated into Thistle. */
export class ThistleMem64 implements RvMemory {
  private readonly pid: number;
  constructor(
    private readonly memory: ThistleMemory,
    private readonly hart: number,
    readonly top: bigint,
    readonly cap: number,
    private readonly page: ThistlePageLookup = (hart, address, create) => thistleGuestPage(memory, hart, address, create),
    private readonly onWrite: ((address: bigint, length: number) => void) | null = null,
  ) {
    const record = processForHart(memory, hart);
    if (record === INVALID_POINTER) bad("ESRCH", "unbound guest memory view");
    this.pid = loadU32(memory, record + P_PID);
  }

  private record(): number {
    const record = processForHart(this.memory, this.hart);
    if (record === INVALID_POINTER || loadU32(this.memory, record + P_PID) !== this.pid) bad("ESRCH", "expired guest memory view");
    return record;
  }

  get used(): number {
    return loadU32(this.memory, this.record() + P_PAGE_COUNT) * THISTLE_GUEST_PAGE_SIZE;
  }

  read(at: bigint, n: number): Uint8Array {
    this.check(at, n);
    const output = new Uint8Array(n);
    let position = 0;
    while (position < n) {
      const address = at + BigInt(position);
      const offset = Number(address & 0xffffn);
      const length = Math.min(n - position, THISTLE_GUEST_PAGE_SIZE - offset);
      const frame = this.page(this.hart, address, false) >>> 0;
      switch (true) {
case !!(frame < UNMAPPED): { output.set(this.memory.bytes.subarray(frame + offset, frame + offset + length), position);
break; }
case !!(frame === INVALID): { bad("ENOMEM", "Thistle page-table lookup failed");
break; }
}
      position += length;
    }
    return output;
  }

  write(at: bigint, bytes: Uint8Array): void {
    this.check(at, bytes.length);
    if (bytes.length === 0) return;
    const marked = thistleMarkGuestWrite(this.memory, this.hart, at, bytes.length);
    checkNative(marked);
    this.populate(at, bytes);
    if (marked !== 0 && this.onWrite !== null) this.onWrite(at, bytes.length);
  }

  /** Load mapping bytes without recording guest write authority. */
  populate(at: bigint, bytes: Uint8Array): void {
    this.check(at, bytes.length);
    let position = 0;
    while (position < bytes.length) {
      const address = at + BigInt(position);
      const offset = Number(address & 0xffffn);
      const length = Math.min(bytes.length - position, THISTLE_GUEST_PAGE_SIZE - offset);
      const part = bytes.subarray(position, position + length);
      let frame = this.page(this.hart, address, false) >>> 0;
      if (frame === UNMAPPED && part.some(value => value !== 0)) frame = this.page(this.hart, address, true) >>> 0;
      if (frame === INVALID) bad("ENOMEM", "Thistle physical-memory budget exhausted");
      if (frame < UNMAPPED) this.memory.bytes.set(part, frame + offset);
      position += length;
    }
  }

  /** Publish only changed bytes, clearing the canonical bitmap after successful storage. */
  flushDirty(at: bigint, length: number, publish: (writes: DirtyWrite[]) => void): void {
    this.check(at, length);
    const record = this.record(), table = loadU32(this.memory, record + P_PAGE_TABLE);
    const count = loadU32(this.memory, record + P_PAGE_CAPACITY), end = at + BigInt(length);
    const spans: DirtySpan[] = [];
    for (let index = 0; index < count; index++) {
      spans.push(...pageDirtySpans(this.memory, table + index * THISTLE_PAGE_ENTRY_SIZE, at, end));
    }
    if (spans.length === 0) return;
    const writes = spans.map(span => ({ at: span.at, bytes: this.read(span.at, span.length) }));
    publish(writes);
    for (const span of spans) clearDirtyBytes(this.memory, span.entry, span.offset, span.length);
  }

  drop(at: bigint, n: number): void {
    this.check(at, n);
    const record = this.record(), table = loadU32(this.memory, record + P_PAGE_TABLE);
    const count = loadU32(this.memory, record + P_PAGE_CAPACITY), end = at + BigInt(n);
    for (let index = 0; index < count; index++) {
      const entry = table + index * THISTLE_PAGE_ENTRY_SIZE, key = loadU64(this.memory, entry);
      if (key === 0n) continue;
      const base = (key - 1n) << 16n, stop = base + BigInt(THISTLE_GUEST_PAGE_SIZE);
      const low = at > base ? at : base, high = end < stop ? end : stop;
      if (low >= high) continue;
      const frame = loadU32(this.memory, entry + 8);
      this.memory.bytes.fill(0, frame + Number(low - base), frame + Number(high - base));
    }
  }

  u8(at: bigint): number { return requireValue(this.read(at, 1)[0] ?? null, "src/thistle/mem64.ts:73"); }
  i8(at: bigint): bigint { return BigInt.asIntN(8, BigInt(this.u8(at))); }
  u16(at: bigint): number { return this.number(at, 2); }
  i16(at: bigint): bigint { return BigInt.asIntN(16, BigInt(this.u16(at))); }
  u32(at: bigint): number { return this.number(at, 4) >>> 0; }
  i32(at: bigint): bigint { return BigInt.asIntN(32, BigInt(this.u32(at))); }

  u64(at: bigint): bigint {
    const bytes = this.read(at, 8);
    let value = 0n;
    for (let index = 7; index >= 0; index--) value = value << 8n | BigInt(requireValue(bytes[index] ?? null, "src/thistle/mem64.ts:83"));
    return value;
  }

  i64(at: bigint): bigint { return BigInt.asIntN(64, this.u64(at)); }

  f32(at: bigint): number {
    const bytes = this.read(at, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
  }

  f64(at: bigint): number {
    const bytes = this.read(at, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  }

  set8(at: bigint, n: bigint | number): void { this.write(at, Uint8Array.of(Number(BigInt.asUintN(8, BigInt(n))))); }
  set16(at: bigint, n: bigint | number): void { this.setNumber(at, BigInt(n), 2); }
  set32(at: bigint, n: bigint | number): void { this.setNumber(at, BigInt(n), 4); }
  set64(at: bigint, n: bigint | number): void { this.setNumber(at, BigInt(n), 8); }

  setF32(at: bigint, n: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, n, true);
    this.write(at, bytes);
  }

  setF64(at: bigint, n: number): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, n, true);
    this.write(at, bytes);
  }

  private number(at: bigint, size: number): number {
    const bytes = this.read(at, size);
    let value = 0;
    for (let index = size - 1; index >= 0; index--) value = value * 256 + requireValue(bytes[index] ?? null, "src/thistle/mem64.ts:119");
    return value;
  }

  private setNumber(at: bigint, n: bigint, size: number): void {
    const value = BigInt.asUintN(size * 8, n);
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index++) bytes[index] = Number(value >> BigInt(index * 8) & 255n);
    this.write(at, bytes);
  }

  private check(at: bigint, n: number): void {
    this.record();
    if (at < 0n || !Number.isSafeInteger(n) || n < 0 || at + BigInt(n) > this.top) {
      bad("ERANGE", `thistle64 address 0x${at.toString(16)}`);
    }
  }
}
