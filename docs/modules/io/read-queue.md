# read-queue

`ReadQueue` retains host transport bytes and pending readers. An aborted read returns `EINTR`, removes only its own waiter and leaves buffered bytes and peer readers intact. Delivery removes the abort listener. Closing drains buffered bytes before subsequent EOF; clearing discards buffered bytes without closing the endpoint.

This queue is shared by pipe and terminal transports. It owns no process, descriptor or kernel metadata.
