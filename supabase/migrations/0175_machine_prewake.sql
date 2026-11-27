-- THE SPECULATIVE WAKE (decision D13, option W1, fleet-prewake.ts).
--
-- hq starts the cold wake of a machine when the person starts to type, so the 15 to 22 s boot
-- overlaps with the typing. A wake that no message follows must stop soon, not after the full idle
-- window. This column marks such a wake:
--   wake_speculative_at  the prewake route started this machine at this time. The route sets it
--                        together with started_at, and only on a machine that was stopped. It does
--                        NOT move last_wake_at, because last_wake_at means "a message arrived".
--
-- The sweep reads a run as speculative while all of these are true: wake_speculative_at is at or
-- after started_at (this run began with the prewake), and last_wake_at and last_active_at are both
-- before it (no message and no work since). Such a run stops after NM_PREWAKE_IDLE_MIN minutes. A
-- message or real work ends the speculative state at once, so no other path needs to clear the
-- column. An old value on a machine that a later wake started is harmless for the same reason.
--
-- Additive only: every existing row reads NULL, which is "never woken speculatively".
alter table machines
  add column if not exists wake_speculative_at timestamptz;

comment on column machines.wake_speculative_at is
  'the prewake route (typing in a composer) started this machine at this time. A run with no message and no work since stops after NM_PREWAKE_IDLE_MIN (fleet-prewake.ts)';
