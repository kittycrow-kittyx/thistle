# Character device transports

`CharacterDevice`: host read/write callbacks and repeat-read policy. `registerDevice`: root-only registration for a canonical character inode. `readDevice` and `writeDevice`: check open rights, invoke the transport outside native locks, then verify the descriptor and cursor before recording the transfer. Registration keys are inode numbers with incarnation tokens; a recycled inode without a new registration returns `EIO`.
