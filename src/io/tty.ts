import { requireValue } from "../core/err.js";
import { enc, Stream } from "./stream.js";
import { ReadQueue } from "./read-queue.js";
import type { In, Out } from "./stream.js";

/*
 * Linux asm-generic kernel termios layout used by RISC-V:
 *
 *   tcflag_t c_iflag;    offset 0
 *   tcflag_t c_oflag;    offset 4
 *   tcflag_t c_cflag;    offset 8
 *   tcflag_t c_lflag;    offset 12
 *   cc_t     c_line;     offset 16
 *   cc_t     c_cc[19];   offset 17
 *
 * Total: 36 bytes.
 */
const TERMIOS_SIZE = 36;
const LFLAG_OFFSET = 12;
const CC_OFFSET = 17;
const NCCS = 19;

/* c_lflag */
const ISIG = 0x0001;
const ICANON = 0x0002;
const ECHO = 0x0008;
const ECHOE = 0x0010;
const ECHOK = 0x0020;
const ECHOCTL = 0x0200;
const ECHOKE = 0x0800;
const IEXTEN = 0x8000;

/* c_cc indexes from asm-generic/termbits.h */
const VINTR = 0;
const VQUIT = 1;
const VERASE = 2;
const VKILL = 3;
const VEOF = 4;
const VTIME = 5;
const VMIN = 6;
const VSWTC = 7;
const VSTART = 8;
const VSTOP = 9;
const VSUSP = 10;
const VEOL = 11;
const VREPRINT = 12;
const VDISCARD = 13;
const VWERASE = 14;
const VLNEXT = 15;
const VEOL2 = 16;

function defaultTermios(): Uint8Array {
  const raw = new Uint8Array(TERMIOS_SIZE);
  const view = new DataView(raw.buffer);

  /*
   * Conventional Linux-like defaults:
   *   input:  BRKINT | ICRNL | IXON | IUTF8
   *   output: OPOST | ONLCR
   *   control: B38400 | CS8 | CREAD
   *   local: canonical input, signals, echo and extended editing
   */
  view.setUint32(0, 0x0002 | 0x0100 | 0x0400 | 0x4000, true);
  view.setUint32(4, 0x0001 | 0x0004, true);
  view.setUint32(8, 0x000f | 0x0030 | 0x0080, true);
  view.setUint32(
    LFLAG_OFFSET,
    ISIG |
      ICANON |
      ECHO |
      ECHOE |
      ECHOK |
      ECHOCTL |
      ECHOKE |
      IEXTEN,
    true,
  );

  raw[16] = 0;                  // N_TTY

  raw[CC_OFFSET + VINTR] = 3;       // Ctrl+C
  raw[CC_OFFSET + VQUIT] = 28;      // Ctrl+\
  raw[CC_OFFSET + VERASE] = 127;    // DEL
  raw[CC_OFFSET + VKILL] = 21;      // Ctrl+U
  raw[CC_OFFSET + VEOF] = 4;        // Ctrl+D
  raw[CC_OFFSET + VTIME] = 0;
  raw[CC_OFFSET + VMIN] = 1;
  raw[CC_OFFSET + VSWTC] = 0;
  raw[CC_OFFSET + VSTART] = 17;     // Ctrl+Q
  raw[CC_OFFSET + VSTOP] = 19;      // Ctrl+S
  raw[CC_OFFSET + VSUSP] = 26;      // Ctrl+Z
  raw[CC_OFFSET + VEOL] = 0;
  raw[CC_OFFSET + VREPRINT] = 18;   // Ctrl+R
  raw[CC_OFFSET + VDISCARD] = 15;   // Ctrl+O
  raw[CC_OFFSET + VWERASE] = 23;    // Ctrl+W
  raw[CC_OFFSET + VLNEXT] = 22;     // Ctrl+V
  raw[CC_OFFSET + VEOL2] = 0;

  return raw;
}

class TtyIn extends Stream implements In {

  private readonly reads = new ReadQueue();

  constructor(override readonly tty: Tty) { super(); }

  rd(signal: AbortSignal | null = null): Promise<Uint8Array> { return this.reads.read(signal); }

  push(bytes: Uint8Array): void { this.reads.push(bytes); }

  flush(): void { this.reads.clear(); }

  wake(): void {
    this.push(new Uint8Array());
  }
}

class TtyOut extends Stream implements Out {

  constructor(
    override readonly tty: Tty,
    private readonly err = false,
  ) { super(); }

  async wr(b: Uint8Array): Promise<number> {
    this.tty.write(
      new TextDecoder().decode(b),
      this.err,
    );

    return b.length;
  }
}

export class Tty {
  readonly input = new TtyIn(this);
  readonly output = new TtyOut(this);
  readonly error = new TtyOut(this, true);

  private line = "";
  private rows = 24;
  private cols = 80;
  private readonly attributes = defaultTermios();

  constructor(
    private readonly put: (
      s: string,
      err: boolean,
    ) => void | Promise<void>,
    private readonly interrupt: (
      signal: number,
    ) => boolean | void,
  ) {}

  write(s: string, err = false): void {
    const pending = this.put(s, err);
    if (pending instanceof Promise) pending.catch(() => {
      // A failed host terminal transport must wake the foreground program.
      this.interrupt(2);
      this.input.wake();
      console.error("terminal output transport failed");
    });
  }

  feed(s: string | Uint8Array): void {
    const text = typeof s === "string"
      ? s
      : new TextDecoder().decode(s);

    if (!this.hasLocalFlag(ICANON)) { this.feedRaw(text); return; }

    for (const ch of text) {
      this.char(ch);
    }
  }

  private feedRaw(text: string): void {
    let pending = "";
    // Retain each host key event as one read so escape sequences reach guest editors intact.
    for (const ch of text) {
      if (this.hasLocalFlag(ISIG) && this.isControlCharacter(ch, VINTR)) {
        this.pushPending(pending);
        pending = "";
        this.signalInterrupt();
        continue;
      }
      pending += ch;
      this.echo(ch);
    }
    this.pushPending(pending);
  }

  private pushPending(pending: string): void {
    if (pending) this.input.push(enc(pending));
  }

  private echo(text: string): void {
    if (this.hasLocalFlag(ECHO)) this.write(text);
  }

  resize(rows: number, cols: number): void {
    this.rows = Math.max(1, Math.trunc(rows));
    this.cols = Math.max(1, Math.trunc(cols));
  }

  size(): {
    rows: number;
    cols: number;
  } {
    return {
      rows: this.rows,
      cols: this.cols,
    };
  }

  termios(): Uint8Array {
    /*
     * Return a copy: guest applications may modify the structure before
     * passing it back through TCSETS.
     */
    return this.attributes.slice();
  }

  lineEditorMode(base: Uint8Array = this.termios()): void {
    const raw = base.slice();
    const view = new DataView(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength,
    );
    const flags = view.getUint32(LFLAG_OFFSET, true);

    /*
     * The shell editor consumes and renders key events itself. Preserve the
     * inherited terminal configuration while disabling kernel line editing,
     * echo and signal interception at the interactive prompt.
     */
    view.setUint32(
      LFLAG_OFFSET,
      flags & ~(ISIG | ICANON | ECHO),
      true,
    );
    raw[CC_OFFSET + VMIN] = 1;
    raw[CC_OFFSET + VTIME] = 0;
    this.setTermios(raw, false);
  }

  setTermios(
    raw: Uint8Array,
    flush: boolean,
  ): void {
    if (raw.byteLength < TERMIOS_SIZE) {
      throw new RangeError(
        `termios buffer is ${raw.byteLength} bytes; expected ${TERMIOS_SIZE}`,
      );
    }

    this.attributes.set(
      raw.subarray(0, TERMIOS_SIZE),
    );

    if (flush) {
      this.line = "";
      this.input.flush();
    }
  }

  reset(): void {
    this.attributes.set(defaultTermios());
    this.line = "";
  }

  private localFlags(): number {
    return new DataView(
      this.attributes.buffer,
      this.attributes.byteOffset,
      this.attributes.byteLength,
    ).getUint32(LFLAG_OFFSET, true);
  }

  private hasLocalFlag(flag: number): boolean {
    return !!(this.localFlags() & flag);
  }

  private control(index: number): number {
    if (index < 0 || index >= NCCS) {
      throw new RangeError(
        `invalid termios control-character index ${index}`,
      );
    }

    return requireValue(this.attributes[CC_OFFSET + index] ?? null, "this.attributes[CC_OFFSET + index]");
  }

  private isControlCharacter(
    ch: string,
    index: number,
  ): boolean {
    const value = this.control(index);

    /*
     * Linux uses zero as _POSIX_VDISABLE for these controls.
     */
    return value !== 0 &&
      ch.length === 1 &&
      ch.charCodeAt(0) === value;
  }

  private isErase(ch: string): boolean {
    const erase = this.control(VERASE);
    const code = ch.charCodeAt(0);

    if (erase !== 0 && code === erase) {
      return true;
    }

    /*
     * Accept both common terminal encodings when the configured erase
     * character is Backspace or DEL.
     */
    return (
      (erase === 0x7f || erase === 0x08) &&
      (code === 0x7f || code === 0x08)
    );
  }

  private eraseLast(): boolean {
    const characters = Array.from(this.line);

    if (!characters.length) {
      return false;
    }

    characters.pop();
    this.line = characters.join("");

    this.echo(this.hasLocalFlag(ECHOE) ? "\b \b" : String.fromCharCode(this.control(VERASE)));

    return true;
  }

  private eraseWord(): void {
    let characters = Array.from(this.line);

    while (
      characters.length &&
      /\s/u.test(requireValue(characters[characters.length - 1] ?? null, "characters[characters.length - 1]"))
    ) {
      this.eraseLast();
      characters = Array.from(this.line);
    }

    while (
      characters.length &&
      !/\s/u.test(requireValue(characters[characters.length - 1] ?? null, "characters[characters.length - 1]"))
    ) {
      this.eraseLast();
      characters = Array.from(this.line);
    }
  }

  private killLine(): void {
    while (this.eraseLast()) {
      // Erase the current canonical input buffer.
    }

    if (
      this.hasLocalFlag(ECHO) &&
      this.hasLocalFlag(ECHOK) &&
      !this.hasLocalFlag(ECHOE)
    ) {
      this.write("\r\n");
    }
  }

  private canonicalEof(): void {
    const pending = this.line;
    this.line = "";

    /*
     * Empty pending input produces a zero-byte read. Non-empty pending
     * input is returned immediately without appending a newline.
     */
    this.input.push(enc(pending));
  }

  private signalInterrupt(): void {
    const handled = this.interrupt(2) !== false;

    this.line = "";

    /*
     * A foreground programme may leave the terminal in raw or no-echo mode.
     * Restore interactive defaults when Ctrl+C returns control to a shell.
     */
    if (handled) {
      this.attributes.set(defaultTermios());
    }

    if (handled) this.write(this.hasLocalFlag(ECHOCTL) ? "^C\r\n" : "\r\n");

    this.input.wake();
  }

  private char(ch: string): void {
    if (
      this.hasLocalFlag(ISIG) &&
      this.isControlCharacter(ch, VINTR)
    ) {
      this.signalInterrupt();
      return;
    }

    if (!this.hasLocalFlag(ICANON)) {
      this.input.push(enc(ch));

      this.echo(ch);

      return;
    }

    if (this.isErase(ch)) {
      this.eraseLast();
      return;
    }

    if (this.isControlCharacter(ch, VWERASE)) {
      this.eraseWord();
      return;
    }

    if (this.isControlCharacter(ch, VKILL)) {
      this.killLine();
      return;
    }

    if (this.isControlCharacter(ch, VEOF)) {
      this.canonicalEof();
      return;
    }

    if (ch === "\r" || ch === "\n") {
      this.echo("\r\n");

      this.input.push(enc(this.line + "\n"));
      this.line = "";
      return;
    }

    this.line += ch;

    this.echo(ch);
  }
}
