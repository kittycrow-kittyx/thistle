# Hosted RV64 integration tests

Checks output from a canonical RV64 guest on a non-zero hart in the hosted
kernel's existing memory instance. Repeated setuid/getuid/exit execution verifies
shared native credentials, process reaping and frame reuse. Host credential
requests also exercise native permission checks and snapshot isolation.
