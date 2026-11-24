# fd

`FdFlags` describes access, append and close-on-exec bits. An uninstalled `Fd` is a detached request with optional stream endpoints and a legacy file path. `FdTable.set` binds the request to a canonical host descriptor; `get` retrieves its attached capability. `pos`, `rd`, `wr`, `add` and `clo` consult the native slot once installed. `FdTable.next` finds an available slot; `delete` and `clear` close native records. Stream holds and releases remain host capability operations.

`keys`, `values` and `entries` return snapshots of occupied native slots, including inode descriptors allocated directly by native syscalls. `attachment` and `attachments` expose host endpoints for cleanup after reaping. The attachment map does not determine slot membership.

Inode-bound `Fd` views expose native `readFile`, `writeFile` and `seekFile` operations.
