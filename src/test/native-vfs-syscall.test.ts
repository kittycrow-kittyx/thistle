import { requireValue } from "../core/err.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { directMemory, storeU8, storeU32, loadU8 } from "../native/memory.js";
import { THISTLE_BATCH_BUDGET, THISTLE_BATCH_SYSCALL, THISTLE_SEGMENT_READ, THISTLE_SEGMENT_WRITE, THISTLE_SEGMENT_EXECUTE } from "../native/abi.js";
import { thistleKernelInit, thistleKernelInitWithVfs, thistleHartInit, thistleProcessInit, thistleImageReserve, thistleImageRelease, thistleImageBegin,
  thistleImageSegment, thistleImageFinish, thistleHartSetPc, thistleHartSetX, thistleHartGetX, thistleRunRv64Batch,
  thistleProcessRecord, thistleVfsUnlink, thistleStackPrepare, thistleResumeSyscall, thistleGuestPage, thistleMapHostFile, thistleUnmapHostFile, thistleProcessMapCount } from "../native/kernel.js";
import { thistleLoadVfs, thistleVfsKind } from "../native/vfs.js";

for (const mounted of [true, false]) test(`guest file syscalls ${mounted ? "use the mounted VFS" : "delegate without a mount"}`, () => {
  const memory = directMemory(64 * 1024 * 1024);
  assert.equal(mounted ? thistleKernelInitWithVfs(memory, 1, false, 8192, 16384, 24 * 1024 * 1024) : thistleKernelInit(memory, 1, false), 0);
  const image = new Uint8Array(32 + 56 + 60 + 20);
  const v = new DataView(image.buffer);
  const put = (at: number, n: number): void => v.setUint32(at, n, true);
  put(0, 0x31534656); put(4, 1); put(8, 2); put(12, 1); put(16, 1); put(20, image.length);
  put(32, 1); put(36, 2); put(40, 0o755); put(52, 1);
  put(88, 2); put(92, 1); put(96, 0o644); put(108, 1); put(112, 3);
  image.set([65, 66, 67], 144);
  put(148, 1); put(152, 2); put(156, 1); image[164] = 102;
  let checksum = 2166136261;
  for (const byte of image.subarray(32)) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0;
  put(24, checksum);
  const input = thistleImageReserve(memory, image.length);
  for (let i = 0; i < image.length; i++) storeU8(memory, input + i, BigInt(requireValue(image[i] ?? null, "image[i]")));
  if (mounted) assert.equal(thistleLoadVfs(memory, input, image.length), 0);
  assert.equal(thistleImageRelease(memory, input, image.length), 0);
  assert.equal(thistleHartInit(memory, 0, 0x10000000n, 0x200000n), 0);
  assert.equal(thistleProcessInit(memory, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  const code = thistleImageReserve(memory, 16);
  storeU32(memory, code, 0x73);
  storeU8(memory, code + 4, 47n); storeU8(memory, code + 5, 102n); storeU8(memory, code + 6, 0n);
  assert.equal(thistleImageBegin(memory, 0, 0x10000000n, 0x200000n, 0n, 0, 0), 0);
  assert.equal(thistleImageSegment(memory, 0, 1, 1, 0x200000n, 4n, THISTLE_SEGMENT_READ | THISTLE_SEGMENT_EXECUTE, code, 4), 0);
  assert.equal(thistleImageSegment(memory, 0, 2, 1, 0x210000n, 4096n, THISTLE_SEGMENT_READ | THISTLE_SEGMENT_WRITE, code + 4, 3), 0);
  assert.equal(thistleImageFinish(memory, 0, 7), 0);
  assert.equal(thistleImageRelease(memory, code, 16), 0);
  const call = (nr: number, a: bigint, b = 0n, c = 0n): bigint => {
    thistleHartSetPc(memory, 0, 0x200000n);
    thistleHartSetX(memory, 0, 17, BigInt(nr));
    thistleHartSetX(memory, 0, 10, a); thistleHartSetX(memory, 0, 11, b); thistleHartSetX(memory, 0, 12, c);
    assert.equal(thistleRunRv64Batch(memory, 0, 1, 0n, -1), THISTLE_BATCH_BUDGET);
    return thistleHartGetX(memory, 0, 10);
  };
  if (!mounted) {
    thistleHartSetX(memory, 0, 17, 56n);
    thistleHartSetX(memory, 0, 10, -100n);
    thistleHartSetX(memory, 0, 11, 0x210000n);
    assert.equal(thistleRunRv64Batch(memory, 0, 1, 0n, -1), THISTLE_BATCH_SYSCALL);
    assert.equal(thistleStackPrepare(memory, 0, 0x0fe00000n, 0x0ffffff0n), 0);
    const mapped = thistleMapHostFile(memory, 0, 0n, 4096n, 3n, 1n);
    assert.ok(mapped > 0n);
    assert.equal(thistleProcessMapCount(memory, 0), 1);
    assert.ok(thistleGuestPage(memory, 0, mapped, true) < 0xfffffffe);
    // munmap must stop at the host boundary before discarding shared bytes.
    thistleHartSetPc(memory, 0, 0x200000n);
    thistleHartSetX(memory, 0, 17, 215n);
    thistleHartSetX(memory, 0, 10, mapped);
    thistleHartSetX(memory, 0, 11, 4096n);
    // The earlier delegated open leaves the hart waiting; resume it first.
    thistleResumeSyscall(memory, 0, mapped);
    assert.equal(thistleRunRv64Batch(memory, 0, 1, 0n, -1), THISTLE_BATCH_SYSCALL);
    assert.equal(thistleProcessMapCount(memory, 0), 1);
    assert.equal(thistleUnmapHostFile(memory, 0, mapped, 4096n), 0n);
    assert.equal(thistleProcessMapCount(memory, 0), 0);
    return;
  }
  assert.equal(call(56, -100n, 0x210000n, 1n), -30n);
  assert.equal(call(56, -100n, 0x220000n), -14n);
  const fd = call(56, -100n, 0x210000n);
  assert.equal(fd, 3n);
  assert.equal(call(63, fd, 0x200000n, 3n), -14n);
  assert.equal(call(63, fd, 0x210100n, 3n), 3n);
  const page = thistleGuestPage(memory, 0, 0x210100n, false);
  assert.deepEqual([loadU8(memory, page + 0x100), loadU8(memory, page + 0x101), loadU8(memory, page + 0x102)], [65, 66, 67]);
  assert.equal(call(63, fd, 0x210100n, 3n), 0n);
  assert.equal(call(62, fd, -1n, 2n), 2n);
  assert.equal(call(63, fd, 0x210100n, 3n), 1n);
  assert.equal(loadU8(memory, page + 0x100), 67);
  const name = thistleImageReserve(memory, 1);
  storeU8(memory, name, 102n);
  assert.equal(thistleVfsUnlink(memory, thistleProcessRecord(memory, 0), 1, name, 1, false, 1n), 0);
  assert.equal(thistleImageRelease(memory, name, 1), 0);
  assert.equal(thistleVfsKind(memory, 2), 1);
  assert.equal(call(57, fd), 0n);
  assert.equal(thistleVfsKind(memory, 2), 0);
  assert.equal(call(63, fd, 0x210100n, 3n), -9n);
});
