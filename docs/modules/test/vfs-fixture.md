# Canonical VFS test fixtures

`rootVfsImage` creates a checksummed VFS image with one root directory.
`mountedKernel` initialises canonical memory, imports the image and creates
root process 1 on hart zero. Its optional argument sets the hart count.
