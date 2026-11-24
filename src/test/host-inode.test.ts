import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel, rootVfsImage } from "./vfs-fixture.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { withImage } from "../host/native-access.js";
import { thistleLoadVfs, thistleVfsIdentity } from "../native/vfs.js";
import { thistleVfsCreate, thistleVfsWrite, thistleVfsLink, thistleVfsRename, thistleVfsUnlink } from "../native/vfs-edit.js";
import { thistleHartInit, thistleProcessInit, thistleProcessReap } from "../native/kernel.js";
import { enc } from "../io/stream.js";

test("inode views survive edits and renames but reject recycled slots", () => {
  const memory = mountedKernel(), process = new HostProcess(memory, 0);
  const view = withImage(memory, 16, input => {
    memory.bytes.set(enc("filealiasnew"), input);
    const inode = process.withFilesystem(record => thistleVfsCreate(memory, record, 1, input, 4, 1, 0o600, 1n));
    const view = new HostInode(memory, inode), identity = view.identity;
    assert.equal(view.access(process, record => thistleVfsWrite(memory, record, inode, input, 4, 0, true, 2n)), 4);
    assert.equal(thistleVfsIdentity(memory, inode), identity);
    assert.equal(view.metadata().size, 4n);
    assert.equal(view.access(process, record => thistleVfsLink(memory, record, 1, inode, input + 4, 5, 3n)), inode);
    assert.equal(view.access(process, record => thistleVfsRename(memory, record, 1, input, 4, 1, input + 9, 3, 4n)), 0);
    return view;
  });
  assert.deepEqual(view.read(process, 0n, 8), enc("file"));
  withImage(memory, 16, input => {
    memory.bytes.set(enc("filealiasnew"), input);
    const inode = view.ino, identity = view.identity;
    assert.equal(view.access(process, record => thistleVfsUnlink(memory, record, 1, input + 9, 3, false, 5n)), 0);
    assert.equal(view.metadata().nlink, 1);
    assert.equal(view.access(process, record => thistleVfsUnlink(memory, record, 1, input + 4, 5, false, 6n)), 0);
    assert.throws(() => view.metadata(), { code: "ENOENT" });
    const replacement = process.withFilesystem(record => thistleVfsCreate(memory, record, 1, input, 4, 1, 0o600, 7n));
    assert.equal(replacement, inode);
    assert.notEqual(thistleVfsIdentity(memory, inode), identity);

    assert.equal(new HostInode(memory, inode).metadata().size, 0n);
  });
  assert.throws(() => view.read(process, 0n, 4), { code: "ENOENT" });
});

test("remount expires inode views and reads validate the live process authority", () => {
  const memory = mountedKernel(2), root = new HostProcess(memory, 0), directory = new HostInode(memory, 1);
  const image = rootVfsImage();
  withImage(memory, image.length, input => {
    memory.bytes.set(image, input);
    assert.equal(thistleLoadVfs(memory, input, image.length), 0);
  });
  assert.throws(() => directory.metadata(), { code: "ENOENT" });
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 1000, 1000, 1000, 1000, 1000, 1000), 0);
  const other = new HostProcess(memory, 1);
  const view = withImage(memory, 8, input => {
    memory.bytes.set(enc("secret"), input);
    const inode = root.withFilesystem(record => thistleVfsCreate(memory, record, 1, input, 6, 1, 0o600, 1n));
    const view = new HostInode(memory, inode);
    assert.equal(view.access(root, record => thistleVfsWrite(memory, record, inode, input, 6, 0, true, 2n)), 6);
    return view;
  });
  assert.deepEqual(view.read(root, 0n, 6), enc("secret"));
  assert.throws(() => view.read(other, 0n, 6), { code: "EACCES" });
  assert.throws(() => view.read(root, -1n, 6), { code: "EINVAL" });
  const foreign = new HostProcess(mountedKernel(), 0);
  assert.throws(() => view.read(foreign, 0n, 6), { code: "ESRCH" });
  other.finish(0);
  assert.equal(thistleProcessReap(memory, 0, other.pid), 0);
  assert.throws(() => view.read(other, 0n, 6), { code: "ESRCH" });
});
