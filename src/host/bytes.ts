/** Existing static-root byte-provider contract, independent of inode metadata. */
export interface RegSource {
  readonly size: number;
  readonly sum: string;
  readonly head: Uint8Array | null;
  load(): Promise<Uint8Array>;
}

/** Coalesce in-flight provider I/O; publication belongs to the caller. */
export class SourceLoad {
  private pending: Promise<Uint8Array> | null = null;

  constructor(readonly source: RegSource) {}

  read(): Promise<Uint8Array> {
    if (this.pending !== null) return this.pending;
    this.pending = this.source.load().then(bytes => {
      if (bytes.length !== this.source.size) throw new Error("lazy regular-file size mismatch");
      return bytes;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
