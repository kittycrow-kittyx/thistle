import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceLoad } from "../host/bytes.js";
import { Reg } from "../fs/vfs.js";
import { createHostKernel } from "../core/host-kernel.js";

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

test("canonical Reg view retains replacement during an in-flight shared source load", async () => {
  let finish: (bytes: Uint8Array) => void = () => { throw new Error("source not loaded"); };
  const kernel = createHostKernel(), fs = kernel.fs, root = fs.authority;
  const tree = fs.dump();
  tree.push({ p: "/lazy", id: 2, k: "f", mode: 0o644, uid: 0, gid: 0, at: 0, mt: 0, ct: 0,
    data: null, sum: "", size: 2, to: null,
    source: { size: 2, sum: "", head: null, load: () => new Promise<Uint8Array>(resolve => { finish = resolve; }) } });
  fs.restore(tree);
  const file = fs.at("/lazy", root).node;
  assert.ok(file instanceof Reg);
  const read = file.materialise();
  fs.writeb("/lazy", new Uint8Array([7, 8]), root);
  finish(new Uint8Array([3, 4]));
  await assert.rejects(read, { code: "EAGAIN" });
  assert.deepEqual([...file.data], [7, 8]);
});
