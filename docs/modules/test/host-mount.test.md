# host-mount.test

The root mount fixture restores hard links, a symlink, resident bytes and a lazy 5 GiB file under a 1 KiB resident quota. It checks recorded ownership and timestamps, quota refusal, remount refusal with an open descriptor, expiry of the old byte registry and relative lookup after the root inode changes.
