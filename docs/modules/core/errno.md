# Numeric errno mapping

`errnoNumbers` maps the existing `Errno` names to their guest ABI numbers.
The RV64 adapter uses it for guest returns; host native-access wrappers use
the same mapping for numeric kernel errors.
