-- THE FLEET'S WRITER LEASE (packages/fleet/src/lease.ts, control-api fleet-lease.ts). nm-fleet writes
-- the Cloud Run worker pools, and during its own redeploy two revisions run side by side for a few
-- seconds. Both reconciled, both wrote the same pool 2 s apart (one the old image, one the new), and
-- the second revision replaced a live machine with no drain (runner b62726f3, epoch 6, 2026-10-29).
--
-- One row per lease name. A holder takes it when it is free, when it already holds it, or when the
-- holder's expiry has passed. A holder renews it every pass and gives it up on SIGTERM (expires_at
-- moves to the past). generation moves only when the holder changes, so a new holder can tell a
-- handoff from a renewal. Additive only: nothing existing reads this table.
create table fleet_leases (
  name text primary key check (name ~ '^[a-z][a-z0-9_-]{0,63}$'),
  holder text not null check (length(holder) between 1 and 200),
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  generation bigint not null default 1
);

comment on table fleet_leases is
  'single-writer leases for nm-fleet passes (one per name, e.g. cloudrun): renewed every pass, released on SIGTERM, taken over only after expiry';

-- server-only: nm-api reaches it with its own role, and no client policy exists
alter table fleet_leases enable row level security;
