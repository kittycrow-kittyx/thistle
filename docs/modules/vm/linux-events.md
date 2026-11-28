# vm/linux-events

`RvLinuxEvents` provides hosted eventfd and epoll descriptors, readiness, wake-ups and closure using canonical `Sys` descriptors and streams.

`dispose` removes pipe subscriptions, wakes pending operations and expires the image's event devices. Interrupted reads, writes and waits return EINTR before touching guest memory.
