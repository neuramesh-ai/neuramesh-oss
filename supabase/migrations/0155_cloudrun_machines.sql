-- CLOUD RUN MACHINES (packages/fleet/CLOUDRUN.md): a third substrate, one Cloud Run Worker Pool per
-- machine, RAM plus GCS snapshots. Additive only: every existing row keeps its substrate, and every
-- new column is NULL or 0 on it, so the kube fleet reads nothing new.
--
-- THE EPOCH (D12). One number per machine that names the incarnation allowed to write. It moves in
-- the DATABASE, never in the revision env: every POST /v1/machines/boot adds 1, so a wake (a scale,
-- no revision) and a crash restart (the same revision, the pool's long-lived boot credential) are
-- each a new incarnation. A resize overlaps the old instance with the new one for about 8 s
-- (measured 2026-10-19), and the epoch is what fences the old one: the new boot replaces its token
-- (prev_token_hash answers 409 STALE_EPOCH, never a write) and every write names its epoch.
-- restarts counts the drains that need a NEW INSTANCE without a template change (a restart at the
-- same class): the operator bounces the pool's instance count when its label falls behind.
--
-- THE DRAIN. drain_state: requested (control-api asked, to grow) · draining (under way: the machine's
-- own guard, or a stop that must snapshot first) · resizing (drained, keys stored, epoch bumped, the
-- operator writes the new template). drain_reason says why; a stop (idle, cap) or a roll has a
-- drain_deadline, and a stop that misses it scales to 0 anyway and stamps drain_lost_at (rule M12).
alter table machines drop constraint if exists machines_substrate_check;
alter table machines add constraint machines_substrate_check check (substrate in ('volume', 'claim', 'cloudrun'));

alter table machines
  add column size_class text check (size_class in ('S', 'M', 'L', 'XL')),
  add column epoch bigint not null default 0,
  add column restarts bigint not null default 0,
  add column drain_state text check (drain_state in ('requested', 'draining', 'resizing')),
  add column drain_reason text check (drain_reason in ('grow', 'oom', 'crash', 'idle', 'cap', 'roll')),
  add column drain_deadline timestamptz,
  add column drain_lost_at timestamptz,
  add column parked_at timestamptz,
  add column snapshot_work text,
  add column snapshot_box text,
  add column mem_pct real,
  add column used_mib int,
  add column limit_mib int,
  add column cpu_pct real,
  add column throttle_ratio real,
  -- the pool env's long-lived credential: good for POST /v1/machines/boot and nothing else
  add column boot_credential_hash text,
  -- the epoch the current machine token was issued for, and its short expiry (renewable while current)
  add column token_epoch bigint,
  add column token_expires_at timestamptz,
  -- the token the boot before replaced: recognised only to answer 409 STALE_EPOCH (so the replaced
  -- instance fences itself) instead of a bare 401; it authorises nothing
  add column prev_token_hash text;

comment on column machines.size_class is
  'cloudrun only: S | M | L | XL (packages/fleet/src/cloudrun-spec.ts SIZE_CLASSES); NULL reads as S';
comment on column machines.epoch is
  'cloudrun only: the write fence. +1 on every boot (POST /v1/machines/boot)';
comment on column machines.restarts is
  'cloudrun only: +1 on every drain that ends in a new instance; the pool label restart-gen follows it';
comment on column machines.drain_state is
  'cloudrun only: NULL (running) → requested | draining → resizing → NULL once the new epoch reports running';

create unique index machines_boot_credential on machines (boot_credential_hash) where boot_credential_hash is not null;
create index machines_prev_token_hash on machines (prev_token_hash) where prev_token_hash is not null;
