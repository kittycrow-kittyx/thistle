import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceLoad } from "../host/bytes.js";
import { Reg } from "../fs/vfs.js";

test("shared byte loading coalesces requests and retries a failed provider", async () => {
  let calls = 0;
  const loader = new SourceLoad({ size: 2, sum: "", head: null, load: async () => {
    calls += 1;
    if (calls === 1) throw new Error("transport failed");
    return new Uint8Array([3, 4]);
  } });
  const first = loader.read();
  assert.equal(loader.read(), first);
  await assert.rejects(first, /transport failed/);
  assert.deepEqual([...await loader.read()], [3, 4]);
  assert.equal(calls, 2);
});

test("legacy Reg retains replacement during an in-flight shared source load", async () => {
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  const file = new Reg("", { mode: 0o644, uid: 0, gid: 0, copy: true,
    source: { size: 2, sum: "", head: null, load: () => new Promise(resolve => { finish = resolve; }) } });
  const read = file.materialise();
  file.replace(new Uint8Array([7, 8]));
  finish(new Uint8Array([3, 4]));
  await assert.rejects(read, /source changed during load/);
  assert.deepEqual([...file.data], [7, 8]);
});
