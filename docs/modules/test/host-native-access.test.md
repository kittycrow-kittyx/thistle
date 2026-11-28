# Host native-access regression test

Contended image release schedules cleanup without repeating a committed
callback. The test clears the memory lock, waits for the cleanup event and
checks that the canonical image lease is released.
