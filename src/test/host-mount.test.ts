import assert from "node:assert/strict";
import { test } from "node:test";
import { mountHostTree } from "../host/mount.js";
import { dumpHostTree } from "../host/snapshot.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel } from "./vfs-fixture.js";
import type { TreeEnt } from "../fs/tree.js";
import { thistleOpenPath, thistleCloseDescriptor } from "../native/kernel.js";
import { withImage } from "../host/native-access.js";
import { enc } from "../io/stream.js";

const entry = (p: string, k: TreeEnt["k"], id: number): TreeEnt => ({
  p, k, id, mode: k === "d" ? 0o755 : k === "l" ? 0o777 : 0o4755,
  uid: 1000, gid: 100, at: 10, mt: 11, ct: 12,
  data: k === "f" ? enc("AB") : null, size: k === "f" ? 2 : null,
  sum: null, source: null, to: k === "l" ? "base" : null,
});

test("root mounting retains hard links, lazy storage and recorded metadata", async () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  let loads = 0;
  const sparse: TreeEnt = { ...entry("/sparse", "f", 4), data: null, size: 5 * 1024 ** 3,
    source: { size: 5 * 1024 ** 3, sum: "large", head: null,
      load: () => { loads++; throw new Error("sparse file must stay lazy"); } } };
  const tree = [entry("/", "d", 1), entry("/base", "f", 2), entry("/alias", "f", 2), entry("/link", "l", 3), sparse];
  const backing = mountHostTree(process, tree, 1024), file = new HostInode(memory, 2);
  assert.deepEqual(file.metadata(), { ino: 2, kind: 1, mode: 0o4755, uid: 1000, gid: 100,
    nlink: 2, size: 2n, at: 10n, mt: 11n, ct: 12n });
  assert.deepEqual(await backing.read(2, process), enc("AB"));
  assert.deepEqual(new HostInode(memory, 3).read(process, 0n, 16), enc("base"));
  assert.equal(new HostInode(memory, 4).metadata().size, 5n * 1024n ** 3n);
  assert.equal(loads, 0);
  assert.throws(() => mountHostTree(process, tree, 500), { code: "ENOSPC" });
  assert.deepEqual(await backing.read(2, process), enc("AB"));
  const descriptor = withImage(memory, 5, input => {
    memory.bytes.set(enc("/base"), input);
    return thistleOpenPath(memory, process.hart, 1, input, 5, 0);
  });
  assert.ok(descriptor >= 3);
  assert.throws(() => mountHostTree(process, tree, 1024), { code: "EBUSY" });
  assert.deepEqual(await backing.read(2, process), enc("AB"));
  assert.equal(thistleCloseDescriptor(memory, process.hart, descriptor), 0);
  const replacement = { ...entry("/base", "f", 2), data: enc("CD") };
  const next = mountHostTree(process, [entry("/", "d", 5), replacement], 1024);
  assert.throws(() => file.metadata(), { code: "ENOENT" });
  await assert.rejects(backing.read(2, process), { code: "ENOENT" });
  backing.collect();
  assert.deepEqual(await next.read(2, process), enc("CD"));
  withImage(memory, 4, input => {
    memory.bytes.set(enc("base"), input);
    const descriptor = thistleOpenPath(memory, process.hart, 0, input, 4, 0);
    assert.ok(descriptor >= 3);
    assert.equal(thistleCloseDescriptor(memory, process.hart, descriptor), 0);
  });
});

test("canonical persistence round trip retains aliases, arena data and lazy sources", async () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  const source = { size: 3, sum: "lazy", head: null,
    load: () => { throw new Error("snapshot must not load lazy bytes"); } };
  const sparse: TreeEnt = { ...entry("/sparse", "f", 4), data: null, size: 3, source };
  const entries = [entry("/", "d", 1), entry("/base", "f", 2), entry("/alias", "f", 2), entry("/link", "l", 3), sparse];
  const backing = mountHostTree(process, entries, 4096);
  const directory = HostInode.resolve(process, "/");
  const arena = directory.create(process, "arena", 1, 0o644);
  arena.write(process, enc("xyz"), 0, true);
  directory.create(process, "device", 4, 0o666);
  const dumped = dumpHostTree(process, backing);
  const byPath = new Map(dumped.map(item => [item.p, item]));
  const record = (path: string): TreeEnt => {
    const found = byPath.get(path) ?? null;
    assert.ok(found, path);
    return found;
  };
  assert.equal(record("/base").id, record("/alias").id);
  assert.deepEqual(record("/base").data, enc("AB"));
  assert.deepEqual(record("/arena").data, enc("xyz"));
  assert.equal(record("/link").to, "base");
  assert.equal(record("/sparse").source, source);
  assert.equal(byPath.has("/device"), false);
  const restored = mountHostTree(process, dumped, 4096);
  const restoredArena = HostInode.resolve(process, "/arena");
  assert.deepEqual(await restored.read(restoredArena.ino, process), enc("xyz"));
  assert.equal(HostInode.resolve(process, "/base").ino, HostInode.resolve(process, "/alias").ino);
  const restoredSparse = dumpHostTree(process, restored).find(item => item.p === "/sparse") ?? null;
  assert.ok(restoredSparse);
  assert.equal(restoredSparse.source, source);
});
