import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostKernel } from "../core/host-kernel.js";
import { Sys } from "../core/sys.js";
import { MemIn, MemOut } from "../io/stream.js";
import { Mem64 } from "../vm/mem64.js";
import { RvLinuxEvents } from "../vm/linux-events.js";

const fixture = () => {
  const kernel = createHostKernel(), output = new MemOut();
  const process = kernel.session({ sin: new MemIn(), sout: output, serr: output });
  const memory = new Mem64(0x100000n, 0x10000);
  const events = new RvLinuxEvents(new Sys(kernel, process), () => memory, () => {});
  return { process, memory, events };
};

test("aborted eventfd reads and epoll waits cannot write guest memory", async () => {
  const { process, memory, events } = fixture();
  const fd = events.createEventfd(0, 0), epfd = events.createEpoll(0);
  memory.set32(8n, 1);
  memory.set64(12n, 42n);
  assert.equal(events.ctl(epfd, 1, fd, 8n), 0);
  memory.set64(32n, 99n);
  memory.set64(48n, 77n);
  const read = events.read(fd, 32n, 8);
  const poll = events.wait(epfd, 48n, 1, -1);
  process.ac.abort();
  assert.equal(await read, -4n);
  assert.equal(await poll, -4);
  assert.equal(memory.u64(32n), 99n);
  assert.equal(memory.u64(48n), 77n);
  events.dispose();
});

test("closing and reusing an eventfd cannot resume the old read", async () => {
  const { process, memory, events } = fixture();
  const fd = events.createEventfd(0, 0);
  const read = events.read(fd, 32n, 8);
  events.close(fd);
  process.fds.delete(fd);
  const replacement = events.createEventfd(1, 0);
  assert.equal(replacement, fd);
  assert.equal(await read, -9n);
  assert.equal(await events.read(replacement, 32n, 8), 8n);
  assert.equal(memory.u64(32n), 1n);
  events.dispose();
});

test("disposing an image wakes blocked eventfd writes without aborting the process", async () => {
  const { process, memory, events } = fixture();
  const fd = events.createEventfd(1, 0);
  memory.set64(16n, 0xfffffffffffffffen);
  const write = events.write(fd, 16n, 8);
  events.dispose();
  assert.equal(await write, -4n);
  assert.equal(process.ac.signal.aborted, false);
});
