import { bad } from "../core/err.js";
import { thistleVfsChdir, thistleVfsCwdPath } from "../native/vfs.js";
import { withImage, checkNative } from "./native-access.js";
import type { HostProcess } from "./process.js";

/** Marshal the path into the existing native working-directory operation. */
export const changeDirectory = (process: HostProcess, path: string): void => {
  const bytes = new TextEncoder().encode(path), memory = process.memory;
  if (bytes.length > 4096) bad("ENAMETOOLONG", path);
  withImage(memory, Math.max(1, bytes.length), input => process.withFilesystem(record => {
    memory.bytes.set(bytes, input);
    checkNative(thistleVfsChdir(memory, record, input, bytes.length));
  }));
};

/** Reconstruct cwd from canonical dentries without a second path cache. */
export const currentDirectory = (process: HostProcess): string => {
  const memory = process.memory;
  return withImage(memory, 4096, input => process.withFilesystem(record => {
    const length = thistleVfsCwdPath(memory, record, input, 4096);
    checkNative(length);
    return new TextDecoder().decode(memory.bytes.subarray(input, input + length - 1));
  }));
};
