-- Machine releases and upgrades that each owner controls (docs/design/whats-new-upgrades-2026-11/plan.md §4).
-- Until now one fleet-wide image (FLEET_CLOUDRUN_IMAGE on nm-fleet) ran on every cloud machine, and a release
-- rolled them all. A release is now a row, each machine names the release it runs, and an upgrade is an attempt
-- with its own record. Every change is additive: a machine with a null image_version runs the fleet's own image,
-- exactly as before. Server-only: none of these tables or columns enters the replica.

-- what was released: one row per machine image, with the notes that the What's new card shows
create table machine_releases (
  version text primary key check (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]+$'),
  image text not null unique check (image ~ '@sha256:[0-9a-f]{64}$'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  state text not null default 'candidate' check (state in ('candidate', 'qualified', 'published', 'withdrawn')),
  -- the snapshot formats this image reads (the boot's snapshotFormats): a rollback goes only to a reader
  snapshot_formats text[] not null default '{}',
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  released_on date,
  security_deadline timestamptz,
  qualified_at timestamptz,
  qualified_by text,
  qualification jsonb,
  published_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text,
  created_at timestamptz not null default now(),
  check (state = 'candidate' or qualified_at is not null),
  check (state not in ('published', 'withdrawn') or published_at is not null)
);
create index machine_releases_published on machine_releases (published_at desc) where state = 'published';

-- the fleet-wide switches: the support floor and the ops hold. One row
create table machine_release_policy (
  id boolean primary key default true check (id),
  floor_version text references machine_releases(version),
  hold boolean not null default false,
  hold_reason text,
  updated_at timestamptz not null default now()
);
insert into machine_release_policy (id) values (true) on conflict do nothing;

-- what each machine runs. image_version is what nm-fleet stamps on the pool (null = the fleet's own image);
-- last_good_version moves when a boot on image_version reaches ready; work is the daemon's last report of
-- the turns and terminals in flight, so no upgrade stops work without a warning (plan §6.4)
alter table machines
  add column if not exists image_version text references machine_releases(version),
  add column if not exists last_good_version text references machine_releases(version),
  add column if not exists work jsonb,
  add column if not exists work_at timestamptz;

-- a user upgrade drains like a roll, but a missed deadline keeps the old release (plan §8.3)
alter table machines drop constraint if exists machines_drain_reason_check;
alter table machines add constraint machines_drain_reason_check
  check (drain_reason in ('grow', 'oom', 'crash', 'idle', 'cap', 'roll', 'upgrade'));

-- each upgrade attempt. The partial unique index makes a second open attempt on one machine impossible
create table machine_upgrades (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  from_version text references machine_releases(version),
  to_version text not null references machine_releases(version),
  requested_by uuid references nm_users(id) on delete set null,
  mode text not null check (mode in ('start', 'next_start', 'now', 'when_idle', 'forced')),
  stop_work boolean not null default false,
  stopped_work jsonb,
  state text not null default 'armed'
    check (state in ('armed', 'staged', 'draining', 'booting', 'ready', 'failed', 'rolled_back', 'cancelled')),
  reason text,
  client_key text not null check (length(client_key) between 8 and 64),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  boot_at timestamptz,
  ready_at timestamptz,
  ended_at timestamptz,
  unique (machine_id, client_key)
);
create unique index machine_upgrades_one_open on machine_upgrades (machine_id)
  where state in ('armed', 'staged', 'draining', 'booting');
create index machine_upgrades_recent on machine_upgrades (created_at desc);

-- what each person saw of each release: per person, never per device, so a Later on the phone holds on the web
create table release_views (
  user_id uuid not null references nm_users(id) on delete cascade,
  version text not null references machine_releases(version) on delete cascade,
  seen_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  primary key (user_id, version)
);

do $$ declare tab text;
begin
  foreach tab in array array['machine_releases', 'machine_release_policy', 'machine_upgrades', 'release_views'] loop
    execute format('alter table %I enable row level security', tab);
    execute format('revoke all on %I from public', tab);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on %I from authenticated', tab); end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on %I from anon', tab); end if;
  end loop;
end $$;

comment on column machines.image_version is
  'The machine release that nm-fleet stamps on this pool (machine_releases.version). Null = the fleet''s own FLEET_CLOUDRUN_IMAGE.';
comment on column machines.last_good_version is
  'The last release whose boot reached ready on this machine. A failed upgrade returns here (plan §8.1).';
