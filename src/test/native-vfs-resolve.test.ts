import assert from "node:assert/strict";
import { test } from "node:test";
import { mountedKernel } from "./vfs-fixture.js";
import { thistleProcessRecord } from "../native/process-state.js";
import { thistleVfsResolve } from "../native/vfs.js";
import { thistleVfsCreate, thistleVfsWrite } from "../native/vfs-edit.js";
import { P_FSUID, P_FSGID } from "../native/abi.js";
import { storeU32 } from "../native/memory.js";
import { withImage } from "../host/native-access.js";
import { enc } from "../io/stream.js";

test("path traversal checks directory search permission before dot components", () => {
  const memory = mountedKernel(), proc = thistleProcessRecord(memory, 0);
  withImage(memory, 512, input => {
    const name = (text: string): number => {
      const bytes = enc(text); memory.bytes.set(bytes, input); return bytes.length;
    };
    const create = (parent: number, text: string, kind: number, mode: number): number => {
      const inode = thistleVfsCreate(memory, proc, parent, input, name(text), kind, mode, 1n);
      assert.ok(inode > 1); return inode;
    };
    const denied = create(1, "denied", 2, 0);
    const directory = create(1, "dir", 2, 0o755);
    create(directory, "sub", 2, 0o755);
    const file = create(1, "file", 1, 0o644);
    const link = create(1, "link", 3, 0o777);
    assert.equal(thistleVfsWrite(memory, proc, link, input, name("dir/sub"), 0, true, 1n), 7);
    const resolve = (path: string, start = 1, follow = true): number =>
      thistleVfsResolve(memory, proc, start, input, name(path), follow);
    assert.equal(resolve("/denied/.."), 1);
    assert.equal(resolve("/file/."), -20);
    assert.equal(resolve("/file/.."), -20);
    assert.equal(resolve("/link", 1, false), link);
    assert.equal(resolve("/link/.."), directory);
    storeU32(memory, proc + P_FSUID, 1000); storeU32(memory, proc + P_FSGID, 1000);
    assert.equal(resolve("/denied/.."), -13);
    assert.equal(resolve("/denied/."), -13);
    assert.equal(resolve(".", denied), -13);
    assert.equal(resolve("..", denied), -13);
    assert.equal(resolve("/dir/../file"), file);
    assert.equal(resolve("/link/.."), directory);
    assert.equal(resolve("/dir/../"), 1);
    assert.equal(resolve("/" + "x".repeat(256)), -36);
  });
});
