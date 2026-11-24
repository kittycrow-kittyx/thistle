# Numeric errno mapping

`errnoNumbers` maps the existing `Errno` names to their guest ABI numbers.
The RV64 adapter uses it for guest returns; host native-access wrappers use
the same mapping for numeric kernel errors.

`wasiErrnoNumbers` maps the same error names to WASI Preview 1 numbering, shared
by the WASI and legacy VM adapters.
