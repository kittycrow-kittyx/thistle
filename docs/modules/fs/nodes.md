# Inode views

`VNode`, `Reg`, `Dir`, `Sym` and `Chr` reference a live `HostInode`, calling process and byte transport. Metadata getters consult native state; `Dir.ent` returns a read-only snapshot. `Reg.data` reads resident bytes, `source` exposes an authorised lazy provider, `head` returns its prefix, `materialise` awaits the provider, and `size`, `residentSize`, `lazy`, `sum` describe payload state. `Sym.to` reads the stored link target. `nodeView` selects a typed view, `fileKind` translates the numeric kind, `statView` returns checked numeric metadata, and `fmtMode` formats mode bits.
