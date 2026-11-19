-- ALWAYS ON IS BILLED AS ACTIVE (decision D2, George 2026-11-06; architecture cloud-run-2026-10 §5).
--
-- A normal cloud machine is billed for the active seconds its heartbeat reports, and its standby is
-- free because the idle stop bounds it. An Always on machine (idle_stop_min IS NULL) has no idle
-- stop, so every awake second costs the active price, also when it does no work. The heartbeat
-- charges it (machine-beat.ts): a beat proves that the instance is up, so a machine that is down is
-- never charged.
--
--   machines.billed_through        the time of the last beat that the meter read. The next beat of an
--                                  Always on machine charges the wall time since then, at most
--                                  ALWAYS_ON_MAX_WINDOW_S and never before started_at. The active
--                                  seconds of that beat are inside the same window, so they are not
--                                  charged twice. The Always on switch sets it when it turns on.
--   machine_usage.always_on_seconds the awake seconds that Always on billed on top of the active
--                                  seconds, per workspace per UTC day. active_seconds stays the
--                                  "worked" figure. machine_micros holds the money for both.
--
-- Additive only: NULL billed_through means "no window yet", so the first beat charges nothing extra.
alter table machines
  add column if not exists billed_through timestamptz;

alter table machine_usage
  add column if not exists always_on_seconds int not null default 0;

comment on column machines.billed_through is
  'the last beat the meter read. An Always on machine is charged the wall time since then, capped (machine-beat.ts)';
comment on column machine_usage.always_on_seconds is
  'awake seconds billed by Always on on top of active_seconds (machine-beat.ts). Priced as active';
