import assert from "node:assert/strict";
import { test } from "node:test";
import { Mem64, PG } from "../vm/mem64.js";

test("little-endian scalar loads span a sparse page without allocating it", () => {
  const memory = new Mem64(0x100000n, PG * 2), edge = BigInt(PG);
  memory.write(edge - 2n, Uint8Array.of(0x34, 0x80));
  assert.equal(memory.i16(edge - 2n), -32716n);
  assert.equal(memory.u32(edge - 2n), 0x8034);
  assert.equal(memory.u64(edge - 2n), 0x8034n);
  assert.equal(memory.used, PG);
  memory.write(edge, Uint8Array.of(0x56, 0x78));
  assert.equal(memory.u32(edge - 2n), 0x78568034);
  memory.setF64(edge - 3n, -0);
  assert.ok(Object.is(memory.f64(edge - 3n), -0));
  assert.throws(() => memory.u32(memory.top - 2n));
});
