# Host process-view regressions

Two harts view the same canonical process. Tests cover extended groups,
snapshot mutation isolation, native credential updates, saved-ID recovery,
privilege/error ordering, shared umask and view expiry after PID replacement.

A loader update is visible through both hart views of the process.
