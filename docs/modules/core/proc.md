# proc

`Proc` retains host streams, environment, callback completion and signal
delivery. Its `native` property is a non-owning `HostProcess` view. PID, parent
PID, process group, credentials, filesystem IDs and umask read canonical memory.
`PState` and `Sig` describe the remaining host lifecycle and signal interface.

`Fd` and `FdTable` attach host stream endpoints to canonical descriptor slots. Live offsets and flags reside in native memory. The legacy path binding remains until inode-backed file opens replace it.

`FdFlags` names descriptor access and inheritance flags. `Io` carries standard
streams. `ProcInit` contains host image metadata and streams; construction also
requires the allocated canonical process view. `ExecReplace` transfers control
to a replacement image without allocating a new PID.

Credential getters return snapshots. Use `Sys` or the trusted constructor/validated-exec loader to change credentials.

`state` and `code` read canonical process lifecycle fields. `completed` reports
that host cleanup and the completion promise have finished, which can occur
after native exit. The completed exit receipt remains readable after reaping.

`kids` is a read-only snapshot of canonical child membership.

Signal masks, deferred signals and the latest delivery live in native process
metadata. `signal` and `setSignalMask` delegate policy there. The host abort
controller carries delivery to JavaScript callbacks. Completed receipts retain
the terminal signal alongside the exit code.
