# Root volume

`RootVolume` mounts an initial root in the existing canonical memory with the trusted loader process and resident quota. `backing` is its byte transport, `authority` is the live loader, and `cap` is the configured limit. `restore`, `dump`, `used`, `inodeCount` and `device` delegate to the native image, quota and device operations.
