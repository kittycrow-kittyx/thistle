import assert from "node:assert/strict";
import { test } from "node:test";
import { Kern } from "../core/kernel.js";
import { Sys } from "../core/sys.js";
import { defaultKernelOptions } from "../core/host-options.js";
import { MemIn, MemOut } from "../io/stream.js";
import { directMemory, loadU32, storeU32 } from "../native/memory.js";
import {
  C_CREDENTIAL_LOCK, C_NEXT_PID, P_EGID, P_EUID, P_FSGID, P_FSUID,
  P_RGID, P_RUID, P_SGID, P_SUID, P_UMASK,
} from "../native/abi.js";
import { thistleHartInit, thistleKernelInitWithVfs, thistleProcessInit } from "../native/kernel.js";
import { thistleNextPid, thistleProcessIdentity, thistleProcessRecord, thistleProcessUmask } from "../native/process-state.js";

test("canonical credential operations match the hosted identity contract", () => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleKernelInitWithVfs(memory, 2, false, 16, 32, 4096), 0);
  assert.equal(thistleHartInit(memory, 0, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 0, 1, 0, 0, 0, 0, 0, 0, 0), 0);
  const kernel = new Kern(defaultKernelOptions()), output = new MemOut();
  const process = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const sys = new Sys(kernel, process), proc = thistleProcessRecord(memory, 0), keep = 0xffffffff;
  assert.equal(thistleProcessRecord(memory, 1), 0xffffffff);
  const compare = (): void => {
    assert.deepEqual([P_RUID, P_EUID, P_SUID, P_FSUID, P_RGID, P_EGID, P_SGID, P_FSGID]
      .map(field => loadU32(memory, proc + field)),
    [sys.ruid, sys.euid, sys.suid, process.fsuid, sys.rgid, sys.egid, sys.sgid, process.fsgid]);
  };
  assert.equal(thistleProcessIdentity(memory, 0, 0, 1000, 0, 0), 0n);
  sys.setResuid(1000, 0, 0); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 6, 1000, keep, keep), BigInt(sys.setFsuid(1000))); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 0, keep, keep, keep), 0n);
  sys.setResuid(); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 2, keep, 1000, keep), 0n);
  sys.setReuid(null, 1000); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 4, 2000, keep, keep), -1n);
  assert.throws(() => sys.setUid(2000), { code: "EPERM" }); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 4, 0, keep, keep), 0n);
  sys.setUid(0); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 1, 100, 200, 300), 0n);
  sys.setResgid(100, 200, 300); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 7, 300, keep, keep), BigInt(sys.setFsgid(300))); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 3, keep, 100, keep), 0n);
  sys.setRegid(null, 100); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 0, 0.5, keep, keep), -1n);
  assert.throws(() => sys.setResuid(0.5), { code: "EPERM" }); compare();
  assert.equal(thistleProcessIdentity(memory, 0, 6, -1, keep, keep), BigInt(sys.setFsuid(-1))); compare();
  assert.equal(thistleProcessUmask(memory, 0, 0o077), sys.umask);
  sys.umask = 0o077; assert.equal(loadU32(memory, proc + P_UMASK), sys.umask);
  storeU32(memory, C_CREDENTIAL_LOCK, 1);
  assert.equal(thistleProcessIdentity(memory, 0, 4, 500, keep, keep), -11n); compare();
  storeU32(memory, C_CREDENTIAL_LOCK, 0);
});

test("native PID allocation freezes at exhaustion instead of reusing identities", () => {
  const memory = directMemory(32 * 1024 * 1024);
  assert.equal(thistleNextPid(memory), 0);
  assert.equal(thistleKernelInitWithVfs(memory, 1, false, 16, 32, 4096), 0);
  assert.equal(thistleNextPid(memory), 2);
  assert.equal(thistleNextPid(memory), 3);
  storeU32(memory, C_NEXT_PID, 0xffffffff);
  assert.equal(thistleNextPid(memory), 0);
  assert.equal(thistleNextPid(memory), 0);
  assert.equal(loadU32(memory, C_NEXT_PID), 0xffffffff);
});
