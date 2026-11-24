import { bad } from "../core/err.js";
import { loadU32 } from "../native/memory.js";
import type { ThistleMemory } from "../native/memory.js";
import { thistleVfsReadEntry } from "../native/vfs.js";
import { withImage, withVfsLock } from "./native-access.js";

export interface DirectoryItem {
  readonly name: string;
  readonly inode: number;
  readonly kind: number;
}

/** Materialise a directory snapshot from canonical entries without a second tree. */
export const readDirectory = (memory: ThistleMemory, proc: number, parent: number): DirectoryItem[] =>
  withImage(memory, 272, input => withVfsLock(memory, () => {
    const result: DirectoryItem[] = [], decoder = new TextDecoder();
    let cursor = 0;
    for (;;) {
      const status = thistleVfsReadEntry(memory, proc, parent, cursor, input, 272);
      if (status === 0) return result;
      if (status < 0) bad(status === -13 ? "EACCES" : status === -20 ? "ENOTDIR" : "EIO", "directory read returned " + status);
      const next = loadU32(memory, input + 8);
      if (next <= cursor) bad("EIO", "directory cursor did not advance");
      result.push({ inode: loadU32(memory, input), kind: loadU32(memory, input + 4),
        name: decoder.decode(memory.bytes.subarray(input + 16, input + status)) });
      cursor = next;
    }
  }));
