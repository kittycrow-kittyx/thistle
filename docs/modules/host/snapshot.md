# snapshot

`dumpHostTree` serialises the current canonical filesystem into the existing persistence entry contract. It reads metadata, directory entries and payloads through canonical views, preserving hard-link identity and lazy sources. Character devices are excluded. A filesystem generation change invalidates the snapshot with `EAGAIN`. Only a process with filesystem UID zero may export the root. The returned entries are a transport snapshot, not a writable filesystem engine.
