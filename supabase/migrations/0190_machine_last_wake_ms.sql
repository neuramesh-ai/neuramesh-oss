-- The last measured wake of each machine (thread-wait-and-plan round, George, 2026-11-17). It is
-- the time from the wake stamp (started_at, set by bumpMachineWake) to the first status report of
-- that boot that says the machine is ready. Every place that shows a machine start counts down
-- from it ("Ready in about 0:47"). Null until the first measured wake: clients then use 60 s.
-- Additive and nullable. The replica does not carry it: only the client contract's columns sync.
alter table machines add column if not exists last_wake_ms integer;
