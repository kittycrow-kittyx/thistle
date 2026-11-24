# Canonical process attachment tests

Tests attach a fresh hart to process 2 while process 1 remains independent.
The attached hart shares credentials and guest pages without increasing the
process count. Lock contention, invalid destinations and missing PIDs retain
the existing state. Secondary exit leaves its process alive; leader exit permits
canonical reaping of both hart bindings.
