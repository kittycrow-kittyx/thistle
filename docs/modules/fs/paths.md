# Path helpers

`norm`, `wild` and `wrx` handle lexical path display and glob syntax. `splitParent` extracts a raw parent and final name (`ParentPath`), leaving actual traversal to the canonical kernel. `absolutePath` makes a path absolute without collapsing dot or symlink-sensitive components.
