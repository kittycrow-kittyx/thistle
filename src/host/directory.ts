import { bad } from "../core/err.js";
import { loadU32 } from "../native/memory.js";
import type { HostInode } from "./inode.js";
import type { HostProcess } from "./process.js";
import { thistleVfsReadEntry } from "../native/vfs.js";
import { withImage, checkNative } from "./native-access.js";

export interface DirectoryItem {
  readonly name: string;
  readonly inode: number;
  readonly kind: number;
}

/** Materialise a directory snapshot from canonical entries without a second tree. */
export const readDirectory = (directory: HostInode, process: HostProcess): DirectoryItem[] => {
  const memory = directory.memory;
  return withImage(memory, 272, input => directory.access(process, proc => {
    const result: DirectoryItem[] = [], decoder = new TextDecoder();
    let cursor = 0;
    for (;;) {
      const status = thistleVfsReadEntry(memory, proc, directory.ino, cursor, input, 272);
      if (status === 0) return result;
      checkNative(status);
      const next = loadU32(memory, input + 8);
      if (next <= cursor) bad("EIO", "directory cursor did not advance");
      result.push({ inode: loadU32(memory, input), kind: loadU32(memory, input + 4),
        name: decoder.decode(memory.bytes.subarray(input + 16, input + status)) });
      cursor = next;
    }
  }));
};
