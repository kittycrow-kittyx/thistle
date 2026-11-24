# vfs

The host VFS stores `VNode` instances in directory entries. `Reg`, `Dir`, `Sym` and `Chr` represent regular files, directories, symbolic links and character devices (`Kind`). `Rfn` and `Wfn` define device callbacks; `RegSource` permits deferred payload loading. `Cred`, `credUid` and `credGid` supply permission identities. `norm` resolves lexical path components; `fmtMode` formats mode bits. `Vfs.at` returns a `Hit`, and `Vfs.stat` returns `St`. Mutation methods require a current directory and credentials; the VFS capacity is measured in resident bytes.

`ProcCred` includes real, effective and saved process identities. `SessionCred` accepts either a full process identity or a basic filesystem identity, and `fullCred` expands that identity for process creation.

`RegOptions` describes regular file ownership and storage, while `CharOptions` describes character device permissions and repeat behaviour.

`RegSource` is re-exported from [host byte transport](../host/bytes.md). `Reg`
uses the shared `SourceLoad` transport while retaining its existing replacement
check and public materialisation behaviour during migration.
