# Process identity parity tests

`src/test/native-process-state.test.ts` applies the same UID/GID operations
to the hosted reference API and the canonical process record. It compares
real, effective, saved and filesystem IDs after each change, including saved-ID
privilege recovery, invalid inputs and permission failures.

The fixtures also check credential-lock contention, umask and PID exhaustion.
The hosted engine is retained as a migration reference until equivalent
canonical behaviour is established.
