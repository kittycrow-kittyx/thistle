import assert from "node:assert/strict";
import { test } from "node:test";
import { withImage } from "../host/native-access.js";
import { C_MEMORY_LOCK, C_IMAGE_LOCK } from "../native/abi.js";
import { loadU32, storeU32 } from "../native/memory.js";
import { mountedKernel } from "./vfs-fixture.js";

test("host input leases retry contended release without repeating committed work", async () => {
  const memory = mountedKernel();
  let committed = 0;
  const result = withImage(memory, 24, () => {
    committed += 1;
    storeU32(memory, C_MEMORY_LOCK, 1);
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(loadU32(memory, C_IMAGE_LOCK), 1);
  storeU32(memory, C_MEMORY_LOCK, 0);
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  assert.equal(loadU32(memory, C_IMAGE_LOCK), 0);
  assert.equal(committed, 1);
});
