# Native process reaping tests

`src/test/native-process-reap.test.ts` checks real canonical process records
and guest memory. It rejects reaping a runnable process or a locked hart,
preserves another process's live data, and checks zeroed frame reuse.

A repeated create/map/exit/reap fixture verifies that process slots and backing
frames are reusable and that the physical high-water mark returns to its
initial value. This checks resource lifetime without timing thresholds.
