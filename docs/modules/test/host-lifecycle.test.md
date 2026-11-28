# Hosted lifecycle tests

Checks canonical callback phases and ready snapshots, native phase updates,
terminal receipts and idempotent host completion. Reaping is deferred when
native exit precedes host cleanup and completion.

Child membership also follows native-only allocation and reaping without
hosted process registration.

Deferred native signals reach the host abort controller on unmasking. Terminal
signal receipts remain available after canonical reaping.
