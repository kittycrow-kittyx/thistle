# host-input.test

These fixtures check cancellation of individual pipe and terminal readers, preservation of queued bytes and canonical EOF, shared-input reuse after killing and reaping a callback, and deferred signals against sleeping callbacks.
