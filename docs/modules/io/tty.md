# tty

`Tty` handles canonical and raw terminal input, line editing, echo, control characters, interrupt delivery and window size. Input can be a string or bytes. Raw events preserve escape sequences for guest editors; canonical reads produce completed lines or EOF. Output is delivered via the supplied host callback.

Terminal input shares `ReadQueue` with pipes. Cancelling a process read removes its waiter without closing the terminal or consuming the next line; canonical EOF remains an explicit empty byte array.
