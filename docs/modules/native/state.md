# Native state addresses

| Export | Contract |
| --- | --- |
| `INVALID_POINTER` | The `0xffffffff` sentinel for a missing native record. |
| `hartAt` | Compute a hart address from the fixed ABI base and stride. The caller supplies a validated index. |
| `processAt` | Compute a process-slot address from the canonical table base and stride. The caller supplies a validated slot. |
| `validHart` | Check the configured hart-index bound. It does not assert that a process exists. |
| `processForHart` | Resolve the hart's canonical process slot or return `INVALID_POINTER`. |
| `processSlotByPid` | Find a non-empty process slot with the requested PID, or return the sentinel. |
| `validKernel` | Check the published kernel magic and ABI version. |

Kernel execution, credential changes and host record views use these address
calculations. Callers retain the locks required by the operation they perform.

| Process binding helper | Contract |
| --- | --- |
| `bindProcess` | Bind hart page-table views and limits to the canonical process slot; caller owns process/hart locks. |
| `lockProcessHarts` | Try to lock every hart attached to a process slot, undoing partial acquisition on contention. Caller holds the global process lock. |
| `unlockProcessHarts` | Release matching hart locks below the scan bound, excluding the explicitly retained hart. |
