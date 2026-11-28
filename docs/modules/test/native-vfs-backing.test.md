# Native storage-boundary tests

A 5 GiB logical file fits a 400-byte resident quota without allocating its
payload in the arena. Tests check materialisation, quota rollback, permission
denial, stale completion rejection, inode reuse and metadata reclamation.

Directory tests cover short buffers, EOF, unlink, inode reuse and the host
snapshot reader consuming the same canonical entries.
