import { bad } from "../core/err.js";
import { thistleVfsChdir, thistleVfsCwdPath, thistleVfsChdirInode, thistleVfsDirectoryPath, thistleVfsInheritCwd } from "../native/vfs.js";
import { withImage, checkNative, withVfsLock } from "./native-access.js";
import type { HostProcess } from "./process.js";
import type { HostInode } from "./inode.js";

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

/** Select an already resolved directory with the current process's search rights. */
export const changeDirectoryInode = (process: HostProcess, directory: HostInode): void => {
  directory.access(process, record => checkNative(thistleVfsChdirInode(process.memory, record, directory.ino)));
};

/** Return the current pathname of a live directory, including after rename. */
export const directoryPath = (process: HostProcess, directory: HostInode): string => {
  const memory = process.memory;
  return withImage(memory, 4096, input => directory.access(process, () => {
    const length = thistleVfsDirectoryPath(memory, directory.ino, input, 4096);
    checkNative(length);
    return new TextDecoder().decode(memory.bytes.subarray(input, input + length - 1));
  }));
};

/** Inherit an already held cwd reference without re-resolving a pathname. */
export const inheritDirectory = (parent: HostProcess, child: HostProcess): void => {
  parent.withDescriptorPair(child, (source, destination) => withVfsLock(parent.memory, () =>
    checkNative(thistleVfsInheritCwd(parent.memory, source, destination))));
};
