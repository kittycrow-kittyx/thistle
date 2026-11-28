import type { Proc } from "./proc.js";
import type { HostContext } from "../host/context.js";

export class Sched {
  ticks = 0;

  constructor(private readonly context: HostContext) {}

  get ready(): number[] { return this.context.readyPids(); }

  add(p: Proc, fn: () => Promise<void>): void {
    p.state = "ready";
    queueMicrotask(() => {
      if (p.code !== null) return;
      p.state = "run";
      this.ticks++;
      fn().catch(() => p.end(126));
    });
  }

  async yield(p: Proc): Promise<void> {
    if (p.code !== null) return;
    p.state = "ready";
    // Big compilers can run for a while. Let paint and network breathe now and then.
    await new Promise<void>(ok => this.ticks % 64 ? queueMicrotask(ok) : setTimeout(ok, 0));
    this.ticks++;
    if (p.code === null) p.state = "run";
  }
}
