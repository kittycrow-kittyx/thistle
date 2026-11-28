import assert from "node:assert/strict";
import { test } from "node:test";
import { HostDescriptor } from "../host/descriptor.js";
import { HostBacking } from "../host/backing.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleVfsSetQuota } from "../native/vfs-backing.js";

test("common open creates through a dangling symlink, honours exclusivity and truncates lazy carriers", () => {
  const memory = mountedKernel(), root = new HostProcess(memory, 0);
  const directory = HostInode.resolve(root, "/"), link = directory.create(root, "alias", 3, 0o777);
  link.write(root, new TextEncoder().encode("target"), 0, true);
  assert.throws(() => HostDescriptor.openPath(root, "/alias", 0xc2), { code: "EEXIST" });
  assert.throws(() => HostDescriptor.openPath(root, "/alias", 0x20000), { code: "ELOOP" });
  const fd = HostDescriptor.openPath(root, "/alias", 0x42, 0o666);
  const file = HostInode.resolve(root, "/target");
  assert.equal(fd.inode, file.ino);
  assert.equal(file.metadata().mode, 0o644);
  assert.equal(fd.writeFile(Uint8Array.of(1, 2)), 2);
  fd.close();
  assert.equal(thistleVfsSetQuota(memory, 1024n), 0);
  const backing = new HostBacking(memory);
  backing.setSource(file.ino, root, { size: 2, sum: "", head: null,
    load: () => { throw new Error("truncate must not load provider"); } });
  const truncated = HostDescriptor.openPath(root, "/target", 0x602);
  assert.equal(truncated.offset, 0);
  assert.equal(file.metadata().size, 0n);
  assert.deepEqual([...truncated.readFile(8)], []);
  assert.equal(truncated.writeFile(Uint8Array.of(9)), 1);
  truncated.close();
  backing.collect();
});
