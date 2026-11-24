import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel, rootVfsImage } from "./vfs-fixture.js";
import { readDirectory } from "../host/directory.js";
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
  assert.deepEqual(readDirectory(new HostInode(memory, 1), process), [
    { name: "new", inode: view.ino, kind: 1 }, { name: "alias", inode: view.ino, kind: 1 },
  ]);
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
  assert.throws(() => readDirectory(directory, root), { code: "ENOENT" });
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

test("host path and metadata views use native traversal, credentials and incarnation", () => {
  const memory = mountedKernel(2), root = new HostProcess(memory, 0);
  withImage(memory, 16, input => {
    memory.bytes.set(enc("deniedfilelink"), input);
    root.withFilesystem(record => {
      assert.ok(thistleVfsCreate(memory, record, 1, input, 6, 2, 0, 1n) > 1);
      assert.ok(thistleVfsCreate(memory, record, 1, input + 6, 4, 1, 0o600, 1n) > 1);
      const link = thistleVfsCreate(memory, record, 1, input + 10, 4, 3, 0o777, 1n);
      assert.ok(link > 1);
      assert.equal(thistleVfsWrite(memory, record, link, input + 6, 4, 0, true, 1n), 4);
    });
  });
  const file = HostInode.resolve(root, "file");
  assert.equal(HostInode.resolve(root, "/link").ino, file.ino);
  assert.notEqual(HostInode.resolve(root, "/link", false).ino, file.ino);
  assert.equal(HostInode.resolve(root, "/denied/..").ino, 1);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 1000, 1000, 1000, 1000, 1000, 1000), 0);
  const other = new HostProcess(memory, 1);
  assert.throws(() => HostInode.resolve(other, "/denied/.."), { code: "EACCES" });
  assert.throws(() => HostInode.resolve(other, "/file/."), { code: "ENOTDIR" });
  assert.throws(() => file.chmod(other, 0o777), { code: "EPERM" });
  assert.throws(() => file.chown(other, 1000, 1000), { code: "EPERM" });
  file.chown(root, 1000, 1000);
  file.chmod(other, 0o640);
  file.utime(other, 10n, 20n);
  const metadata = HostInode.resolve(root, "/file").metadata();
  assert.equal(metadata.mode, 0o640);
  assert.equal(metadata.uid, 1000);
  assert.equal(metadata.at, 10n);
  assert.equal(metadata.mt, 20n);
  assert.throws(() => new HostInode(memory, file.ino, file.identity + 1n), { code: "ENOENT" });
});
