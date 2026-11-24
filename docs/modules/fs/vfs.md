# Hosted VFS facade

`Vfs` mounts the root into the existing canonical memory through `RootVolume`. Its `authority` is the live root loader process; each ordinary operation receives the caller's live `HostProcess`. `at` returns `Hit` with a typed non-owning `VNode` and an absolute path spelling. `need` and `executable` use native access checks; executable bytes are supplied by the trusted loader after execute permission is established.

`readb`, `read`, `writeb`, `write`, `mkfile`, `mkdir`, `char`, `list`, `rm`, `rename`, `link`, `symlink`, `readlink`, `chmod`, `chown`, `utime`, `stat`, `paths` and `glob` marshal requests into native inode and descriptor operations. `used` and `inodeCount` read native usage. `dump` and `restore` use the canonical root image contract; restore refuses active references with EBUSY. `root` is a read-only directory view.

`Cred`, `ProcCred`, `SessionCred`, `fullCred`, `credUid` and `credGid` describe identities for process construction. `Kind`, `Rfn`, `Wfn`, `CharOptions`, `RegSource`, `St` describe the userspace and device API. `Reg`, `Dir`, `Sym`, `Chr`, `VNode`, `fmtMode`, `nodeView`, `statView`, `fileKind` and `norm` are re-exported from their view and path modules.
