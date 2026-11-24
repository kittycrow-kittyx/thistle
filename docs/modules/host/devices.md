# host/devices

`CharacterDevice` describes only host byte callbacks and repeat behaviour. `registerDevice` binds these callbacks to an existing canonical character inode as root. `readDevice` and `writeDevice` consume the native open rights and descriptor incarnation, release locks before invoking callbacks and revalidate the offset before committing completion. Stale inode incarnations cannot reuse a device registration. The registry does not own names, inode metadata, permissions or descriptor lifetimes.
