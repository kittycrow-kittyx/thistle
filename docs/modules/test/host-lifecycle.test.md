# Hosted lifecycle tests

Checks canonical callback phases and ready snapshots, native phase updates,
terminal receipts and idempotent host completion. Reaping is deferred when
native exit precedes host cleanup and completion.

Child membership also follows native-only allocation and reaping without
hosted process registration.
