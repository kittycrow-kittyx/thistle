# cwd

`changeDirectory(process, path)` changes the canonical cwd inode. `currentDirectory(process)` returns the absolute path reconstructed from its dentries. Both validate the live process under filesystem locks.
