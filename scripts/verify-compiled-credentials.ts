import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { THISTLE_ABI_VERSION, C_ABI, C_PHYSICAL_NEXT, P_GROUP_DATA } from "../src/native/abi.ts";
import { rootVfsImage } from "../src/test/vfs-fixture.ts";

type NativeCall = (...args: (number | bigint)[]) => number | bigint;
for (const threaded of [false, true]) {
  const name = threaded ? "teto-threads" : "teto";
  const bytes = await readFile("build/compiler-validation/wasm/compiled/" + name + ".wasm");
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 32768, shared: threaded });
  const { instance } = await WebAssembly.instantiate(bytes, { env: { memory } });
  const exports = instance.exports as Record<string, NativeCall>;
  const invoke = (name: string, ...args: (number | bigint)[]): number | bigint => {
    const fn = exports["teto" + name] ?? null;
    if (fn === null) throw new Error("Missing compiled ABI export " + name);
    return fn(...args);
  };
  const view = new DataView(memory.buffer), data = new Uint8Array(memory.buffer);
  assert.equal(invoke("KernelInitWithVfs", 0, 2, threaded ? 1 : 0, 16, 32, 4096), 0);
  assert.equal(view.getUint32(C_ABI, true), THISTLE_ABI_VERSION);
  const image = rootVfsImage(), imageAt = Number(invoke("ImageReserve", 0, image.length));
  assert.notEqual(imageAt, 0xffffffff);
  data.set(image, imageAt);
  assert.equal(invoke("LoadVfs", 0, imageAt, image.length), 0);
  assert.equal(invoke("ImageRelease", 0, imageAt, image.length), 0);
  assert.equal(invoke("HartInit", 0, 0, 0x10000000n, 0n), 0);
  assert.equal(invoke("ProcessInit", 0, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  const proc = Number(invoke("ProcessRecord", 0, 0));
  const initial = view.getUint32(C_PHYSICAL_NEXT, true);
  const count = 16500, input = Number(invoke("ImageReserve", 0, count * 4));
  for (let index = 0; index < count; index++) view.setUint32(input + index * 4, index + 100, true);
  assert.equal(invoke("ProcessGroups", 0, 0, input, count), 0);
  assert.equal(invoke("ProcessReadGroups", 0, 0, 0, 0), count);
  assert.equal(invoke("ProcessReadGroups", 0, 0, input, count), count);
  for (let index = 0; index < count; index++) assert.equal(view.getUint32(input + index * 4, true), index + 100);
  assert.equal(invoke("ProcessIdentity", 0, 0, 0, 1000, 1000, 0), 0n);
  assert.equal(invoke("ProcessIdentity", 0, 0, 4, 0, 0xffffffff, 0xffffffff), 0n);
  assert.equal(invoke("ProcessGroups", 0, 0, input, 0), 0);
  assert.equal(view.getUint32(proc + P_GROUP_DATA, true), 0);
  assert.equal(view.getUint32(C_PHYSICAL_NEXT, true), initial);
  assert.equal(invoke("ImageRelease", 0, input, count * 4), 0);
  console.log(name + ": ABI " + THISTLE_ABI_VERSION + ", extended groups, identity and frame reuse passed");
}
