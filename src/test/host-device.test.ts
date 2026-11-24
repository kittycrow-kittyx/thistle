import assert from "node:assert/strict";
import { test } from "node:test";
import { HostDescriptor } from "../host/descriptor.js";
import { HostInode } from "../host/inode.js";
import { HostProcess } from "../host/process.js";
import { registerDevice } from "../host/devices.js";
import { mountedKernel } from "./vfs-fixture.js";
import { loadU32, storeU32 } from "../native/memory.js";
import { C_FLAGS, THISTLE_FLAG_HOST_TRANSPORT, THISTLE_FD_HOST } from "../native/abi.js";
import { thistleHartInit, thistleProcessInit } from "../native/kernel.js";

test("character transports use the native open permission and inode lifetime", () => {
  const memory = mountedKernel(2), root = new HostProcess(memory, 0);
  const directory = HostInode.resolve(root, "/");
  const device = directory.create(root, "device", 4, 0o600);
  assert.throws(() => HostDescriptor.openPath(root, "/device", 2), { code: "EXDEV" });
  storeU32(memory, C_FLAGS, loadU32(memory, C_FLAGS) | THISTLE_FLAG_HOST_TRANSPORT);
  assert.equal(thistleHartInit(memory, 1, 0x10000000n, 0n), 0);
  assert.equal(thistleProcessInit(memory, 1, 2, 1, 1000, 1000, 1000, 1000, 1000, 1000), 0);
  const guest = new HostProcess(memory, 1);
  assert.throws(() => HostDescriptor.openPath(guest, "/device", 0), { code: "EACCES" });
  const received: number[] = [];
  registerDevice(device, root, { repeat: false,
    read: length => {
      // Host callbacks may inspect kernel state; no native lock may be held.
      assert.equal(device.metadata().kind, 4);
      return new Uint8Array(Math.min(length, 3)).fill(7);
    },
    write: bytes => { received.push(...bytes); return bytes.length; },
  });
  const fd = HostDescriptor.openPath(root, "/device", 2);
  assert.equal(fd.kind, THISTLE_FD_HOST);
  assert.equal(fd.inode, device.ino);
  assert.deepEqual([...fd.readFile(8)], [7, 7, 7]);
  assert.deepEqual([...fd.readFile(8)], []);
  assert.throws(() => fd.seekFile(0, 0), { code: "ESPIPE" });
  directory.unlink(root, "device");
  assert.equal(fd.writeFile(Uint8Array.of(1, 2)), 2);
  assert.deepEqual(received, [1, 2]);
  assert.equal(device.metadata().nlink, 0);
  fd.close();
  assert.throws(() => device.metadata(), { code: "ENOENT" });
  const replacement = directory.create(root, "device", 4, 0o666);
  assert.equal(replacement.ino, device.ino);
  const fresh = HostDescriptor.openPath(guest, "/device", 0);
  assert.throws(() => fresh.readFile(2), { code: "EIO" });
  registerDevice(replacement, root, { repeat: true, read: length => new Uint8Array(length), write: bytes => bytes.length });
  assert.deepEqual([...fresh.readFile(2)], [0, 0]);
  assert.deepEqual([...fresh.readFile(1)], [0]);
  fresh.close();
});
