import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleHartInit } from "../native/kernel.js";
import { thistleProcessAttach, thistleProcessRecord } from "../native/process-state.js";
import { thistleProcessQueueSignal, thistleProcessSignalMask } from "../native/process-host.js";
import { C_PROCESS_LOCK, P_SIGNAL_PENDING, P_SIGNAL_LAST, P_SIGNAL_MASK } from "../native/abi.js";
import { loadU32, loadU64, storeU32, storeU64 } from "../native/memory.js";
import { withImage } from "../host/native-access.js";

test("canonical signal masks retain pending delivery across attached harts", () => {
  const memory = mountedKernel(2), proc = thistleProcessRecord(memory, 0), term = 1n << 14n;
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessAttach(memory, 1, 1), 0);
  withImage(memory, 16, input => {
    storeU64(memory, input, term);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 0, input), 0);
    assert.equal(loadU64(memory, input), 0n);
    assert.equal(thistleProcessQueueSignal(memory, 1, 1, 15), 0);
    assert.equal(loadU32(memory, proc + P_SIGNAL_PENDING), 15);
    assert.equal(loadU32(memory, proc + P_SIGNAL_LAST), 0);
    assert.equal(thistleProcessQueueSignal(memory, 1, 999, 9), -3);
    assert.equal(thistleProcessQueueSignal(memory, 1, 1, 3), -22);
    storeU32(memory, C_PROCESS_LOCK, 1);
    assert.equal(thistleProcessQueueSignal(memory, 1, 1, 9), -11);
    storeU32(memory, C_PROCESS_LOCK, 0);
    assert.equal(loadU32(memory, proc + P_SIGNAL_PENDING), 15);
    storeU64(memory, input, term);
    assert.equal(thistleProcessSignalMask(memory, 1, 1, 1, input), 0);
    assert.equal(loadU64(memory, input), term);
    assert.equal(loadU32(memory, input + 8), 15);
    assert.equal(loadU32(memory, proc + P_SIGNAL_PENDING), 0);
    assert.equal(loadU32(memory, proc + P_SIGNAL_LAST), 15);
    storeU64(memory, input, 1n << 8n);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 2, input), 0);
    assert.equal(loadU64(memory, proc + P_SIGNAL_MASK), 0n);
    assert.equal(thistleProcessQueueSignal(memory, 1, 1, 9), 1);
    assert.equal(loadU32(memory, proc + P_SIGNAL_LAST), 9);
  });
  assert.equal(thistleProcessSignalMask(memory, 0, 1, 2, 0), -14);
});

test("signal mask results preserve high bits separately from numeric errors", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0), high = 1n << 63n;
  withImage(memory, 16, input => {
    storeU64(memory, input, high);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 2, input), 0);
    assert.equal(loadU64(memory, proc + P_SIGNAL_MASK), high);
    storeU64(memory, input, 2n);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 0, input), 0);
    assert.equal(loadU64(memory, input), high);
    storeU64(memory, input, high);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 1, input), 0);
    assert.equal(loadU64(memory, input), high | 2n);
    assert.equal(loadU64(memory, proc + P_SIGNAL_MASK), 2n);
    assert.equal(thistleProcessSignalMask(memory, 0, 1, 7, input), -22);
    assert.equal(loadU64(memory, proc + P_SIGNAL_MASK), 2n);
  });
});
