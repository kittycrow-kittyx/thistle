import assert from "node:assert/strict";
import { test } from "node:test";
import { HostDescriptor } from "../host/descriptor.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { mountedKernel } from "./vfs-fixture.js";
import { withImage } from "../host/native-access.js";
import { THISTLE_FD_READ, THISTLE_FD_WRITE, THISTLE_FD_APPEND } from "../native/abi.js";
import { thistleReadDescriptor, thistleCloseDescriptor } from "../native/kernel.js";

test("host inode descriptors share native reads and survive unlink", () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  const root = HostInode.resolve(process, "/"), file = root.create(process, "file", 1, 0o600);
  file.write(process, Uint8Array.of(1, 2, 3), 0, true);
  const fd = HostDescriptor.open(process, file, THISTLE_FD_READ);
  assert.equal(fd.inode, file.ino);
  root.unlink(process, "file");
  withImage(memory, 3, input => {
    assert.equal(thistleReadDescriptor(memory, 0, fd.number, input, 2), 2);
    assert.deepEqual([...memory.bytes.subarray(input, input + 2)], [1, 2]);
  });
  assert.equal(fd.offset, 2);
  assert.equal(thistleCloseDescriptor(memory, 0, fd.number), 0);
  assert.throws(() => fd.offset, { code: "EBADF" });
  assert.throws(() => file.metadata(), { code: "ENOENT" });
  const replacement = root.create(process, "new", 1, 0o600);
  replacement.write(process, Uint8Array.of(4, 5), 0, true);
  const append = HostDescriptor.open(process, replacement, THISTLE_FD_WRITE | THISTLE_FD_APPEND);
  assert.equal(append.number, fd.number);
  assert.equal(append.offset, 2);
  assert.throws(() => fd.flags, { code: "EBADF" });
  append.close();
  assert.throws(() => HostDescriptor.open(process, root, THISTLE_FD_WRITE), { code: "EISDIR" });
});
