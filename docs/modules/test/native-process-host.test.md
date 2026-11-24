# Host process lifecycle tests

Checks parked host callbacks, register reset, secondary hart retirement,
peer-process isolation, rejected initialisation of bound harts and lock
contention without partial mutation. A loaded image becomes runnable only
through its existing leader.
