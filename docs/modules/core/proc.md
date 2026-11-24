# proc

`Proc` retains host streams, environment, callback completion and signal
delivery. Its `native` property is a non-owning `HostProcess` view. PID, parent
PID, process group, credentials, filesystem IDs and umask read canonical memory.
`PState` and `Sig` describe the remaining host lifecycle and signal interface.

`Fd` currently holds host stream endpoints, file path, cursor and flags.
Descriptor ownership and signal-state migration remain pending.

`FdFlags` names descriptor access and inheritance flags. `Io` carries standard
streams. `ProcInit` contains host image metadata and streams; construction also
requires the allocated canonical process view. `ExecReplace` transfers control
to a replacement image without allocating a new PID.

Credential getters return snapshots. Use `Sys` or the trusted constructor/validated-exec loader to change credentials.

`state` and `code` read canonical process lifecycle fields. `completed` reports
that host cleanup and the completion promise have finished, which can occur
after native exit. The completed exit receipt remains readable after reaping.

`kids` is a read-only snapshot of canonical child membership.
