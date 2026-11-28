# err

Kernel errors carry guest-visible errno codes (`Errno`, `KErr`). `bad` throws a kernel error, `msg` formats a caught value for diagnostics, and `requireValue` rejects a missing indexed value with EFAULT rather than passing `undefined` into a kernel operation.

`withValue` applies a callback to a present optional value. `ensure` invokes the supplied failure callback when a condition is false.

`indexedValue` and `mappedValue` make missing indexed slots and map entries explicitly nullable. They preserve valid zero, empty-string and false values, allowing callers to handle absence through the existing kernel error boundary.
