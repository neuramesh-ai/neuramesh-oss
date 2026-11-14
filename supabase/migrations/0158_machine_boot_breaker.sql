-- THE CRASH-LOOP BREAKER (architecture §14, R16) AND SNAPSHOT RETENTION (R17), Cloud Run machines only.
--
-- A boot that throws exits PID 1, and Cloud Run restarts the container into the same failure. Every
-- restart is a new boot and a new epoch, and the instance bills while it loops (390 and about 940
-- epochs on two e2e machines). nm-api now counts the boots since the machine's last `running` report:
--   boot_streak        boots in the current streak (a `running` report sets it to 0)
--   boot_streak_since  when the streak's first boot came. A streak older than the window starts again
--   boot_loop_at       the breaker tripped: the boot route refuses the credential (409 BOOT_LOOP), and
--                      desired_replicas is 0. A human wake or message clears it and allows one more boot
--
-- Snapshot retention (fleet-cloudrun-retention.ts) records what it last kept, so the sweep only
-- revisits a machine whose restore point moved:
--   snapshot_gc_work   the work key the machine pointed at when its prefix was last cleaned
--   snapshot_gc_at     when that was
--
-- Additive only: every existing row reads 0 or NULL, which is "no streak, no stamp, never cleaned".
alter table machines
  add column boot_streak int not null default 0,
  add column boot_streak_since timestamptz,
  add column boot_loop_at timestamptz,
  add column snapshot_gc_work text,
  add column snapshot_gc_at timestamptz;

comment on column machines.boot_streak is
  'cloudrun only: boots since the last running report, inside NM_BOOT_LOOP_WINDOW_MIN (fleet-cloudrun-breaker.ts)';
comment on column machines.boot_loop_at is
  'cloudrun only: the crash-loop breaker tripped. Boots get 409 BOOT_LOOP until a human wake or message clears it';
comment on column machines.snapshot_gc_work is
  'cloudrun only: the restore point when snapshot retention last cleaned this machine''s prefix';

-- the retention pass picks the machines whose restore point moved since their last clean
create index machines_snapshot_gc on machines (snapshot_gc_at nulls first)
  where substrate = 'cloudrun' and snapshot_work is not null;
