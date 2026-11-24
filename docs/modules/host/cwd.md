# cwd

`changeDirectory(process, path)` changes the canonical cwd inode. `currentDirectory(process)` returns the absolute path reconstructed from its dentries. Both validate the live process under filesystem locks.

`changeDirectoryInode` selects an existing directory inode using native search permission. `directoryPath` reconstructs its current path, including after rename.
