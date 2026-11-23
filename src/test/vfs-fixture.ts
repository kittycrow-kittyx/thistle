import assert from "node:assert/strict";
import { directMemory } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleHartInit, thistleImageRelease, thistleImageReserve, thistleKernelInitWithVfs, thistleProcessInit } from "../native/kernel.js";
import { thistleLoadVfs } from "../native/vfs.js";

export const rootVfsImage = (): Uint8Array => {
  const bytes = new Uint8Array(88), view = new DataView(bytes.buffer);
  for (const [at, value] of [[0, 0x31534656], [4, 1], [8, 1], [16, 1], [20, 88], [32, 1], [36, 2], [40, 0o755], [52, 1]] as const) view.setUint32(at, value, true);
  let hash = 0x811c9dc5;
  for (const byte of bytes.subarray(32)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  view.setUint32(24, hash, true);
  return bytes;
};

export const mountedKernel = (harts = 1): ThistleMemory => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleKernelInitWithVfs(memory, harts, false, 16, 32, 4096), 0);
  const bytes = rootVfsImage(), image = thistleImageReserve(memory, bytes.length);
  memory.bytes.set(bytes, image);
  assert.equal(thistleLoadVfs(memory, image, bytes.length), 0);
  assert.equal(thistleImageRelease(memory, image, bytes.length), 0);
  assert.equal(thistleHartInit(memory, 0, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  return memory;
};
