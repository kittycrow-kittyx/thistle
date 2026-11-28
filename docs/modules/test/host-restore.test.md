# host-restore.test

A root loader installs resident, lazy and empty payloads while preserving recorded mode, ownership and timestamps. An unprivileged caller receives `EPERM`. A subsequent ordinary write clears the set-ID bits.
