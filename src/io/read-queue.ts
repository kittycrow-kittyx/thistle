import { KErr } from "../core/err.js";

/** Host transport queue with cancellation scoped to a single pending read. */
export class ReadQueue {
  private readonly bytes: Uint8Array[] = [];
  private readonly waiting = new Set<(bytes: Uint8Array) => void>();
  private ended = false;

  get readable(): boolean { return this.bytes.length > 0 || this.ended; }

  async read(signal: AbortSignal | null = null): Promise<Uint8Array> {
    if (signal !== null && signal.aborted) throw new KErr("EINTR", "interrupted");
    const bytes = this.bytes.shift() ?? null;
    if (bytes !== null) return bytes;
    if (this.ended) return new Uint8Array();
    return new Promise<Uint8Array>((resolve, reject) => {
      const deliver = (value: Uint8Array): void => {
        this.waiting.delete(deliver);
        if (signal !== null) signal.removeEventListener("abort", abort);
        resolve(value);
      };
      const abort = (): void => {
        this.waiting.delete(deliver);
        if (signal !== null) signal.removeEventListener("abort", abort);
        reject(new KErr("EINTR", "interrupted"));
      };
      this.waiting.add(deliver);
      if (signal !== null) signal.addEventListener("abort", abort, { once: true });
    });
  }

  push(bytes: Uint8Array): void {
    if (this.ended) return;
    for (const deliver of this.waiting) { deliver(bytes); return; }
    this.bytes.push(bytes);
  }

  clear(): void { this.bytes.length = 0; }

  close(): void {
    this.ended = true;
    for (const deliver of this.waiting) deliver(new Uint8Array());
  }
}
