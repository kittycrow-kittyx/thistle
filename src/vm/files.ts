import { bad, KErr } from "../core/err.js";
import type { Sys } from "../core/sys.js";

const O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0x40, O_EXCL = 0x80, O_TRUNC = 0x200, O_APPEND = 0x400;

/** Shared descriptor operations for the Thistle32 and Thistle64 syscall ABIs. */
export class VmFiles {
  private sin: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private ip = 0;

  constructor(private readonly s: Sys) {}

  async read(fd: number, n: number): Promise<Uint8Array> {
    if (fd !== 0) return this.s.fdr(fd, n);
    if (this.ip >= this.sin.length) { this.sin = await (this.s.p.input(0) ?? bad("EBADF", "stdin")).rd(this.s.p.ac.signal); this.ip = 0; }
    const b = this.sin.slice(this.ip, this.ip + n); this.ip += b.length; return b;
  }

  open(p: string, fl: number, mode: number): number {
    if ((fl & 3) === 3) bad("EINVAL", "invalid open access mode");
    let made = false;
    try { this.s.stat(p); if (fl & O_CREAT && fl & O_EXCL) bad("EEXIST", p); }
    catch (e) {
      if (!(e instanceof KErr) || e.code !== "ENOENT" || !(fl & O_CREAT)) throw e instanceof Error ? e : new Error(typeof e === "string" ? e : "non-Error kernel exception");
      this.s.mkfile(p, new Uint8Array(), mode || 0o666); made = true;
    }
    const ac = fl & 3, plus = ac === O_RDWR, wr = ac === O_WRONLY || plus;
    if (!made && fl & O_TRUNC && wr) this.s.writeb(p, new Uint8Array());
    const kind = fl & O_APPEND ? plus ? "a+" : "a" : plus ? fl & O_TRUNC ? "w+" : "r+" : wr ? fl & O_TRUNC ? "w" : "ow" : "r";
    return this.s.open(p, kind, mode || 0o666);
  }

}
