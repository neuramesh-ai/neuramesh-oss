-- WHEN THIS MACHINE ACTUALLY STARTED, because nothing recorded it.
--
-- The obvious candidate was last_wake_at, and it is wrong: bumpMachineWake sets it on EVERY
-- delivered message ("a refused wake is still activity worth recording"), so now() - last_wake_at
-- is time-since-last-message. On a busy workspace it reads seconds; on a quiet one it reads days;
-- on neither is it uptime. A surface doing that subtraction would be confidently wrong, which is
-- worse than the blank it replaces.
--
-- So: stamped only on the 0 -> 1 transition — the moment the fleet is actually told to run this
-- machine — and cleared wherever the sweep parks it. NULL therefore means "not running", which is
-- the same thing desired_replicas = 0 says, and the two are written in the same statements so
-- they cannot drift.
--
-- Not backfilled on purpose: a machine already running when this deploys has no knowable start,
-- and inventing one (now(), or its last wake) would put a fabricated number on a screen whose
-- entire job is to report a fact. It stays NULL until its next start, and the UI shows uptime
-- only when it has one.
alter table machines add column started_at timestamptz;

comment on column machines.started_at is
  'when the fleet was last told to run this machine (0 -> 1); NULL while stopped. NOT last_wake_at, which moves on every message.';
