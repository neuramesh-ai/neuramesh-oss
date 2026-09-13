-- Skill Packs (docs/decisions 2026-06-16): a versioned bundle of skills imported
-- from a git source (or bundled with NeuraMesh) into a channel. A pack owns its
-- skills (skills.pack_id); toggling the pack toggles discoverability of all its
-- skills at once WITHOUT losing each skill's own on/off state. Disabled = not
-- discoverable by agents (enforced in the discovery query, not prompted).
create table skill_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  channel_id uuid not null references channels (id) on delete cascade, -- packs are always channel-scoped
  name text not null,
  description text not null default '',
  source_url text not null default '',          -- git remote (empty for bundled)
  source_ref text not null default 'main',       -- branch/ref requested
  version text not null default '',              -- resolved commit sha / 'bundled@<ver>'
  origin text not null default 'imported' check (origin in ('bundled', 'imported')),
  enabled boolean not null default true,
  status text not null default 'importing' check (status in ('importing', 'ready', 'error')),
  step text not null default '',                 -- importer progress step (Cloning/Scanning/…)
  progress int not null default 0,               -- 0..100 for the tracker
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one pack name per channel (mirrors skills' active-name scoping)
create unique index skill_packs_name_channel on skill_packs (workspace_id, channel_id, name);
create index skill_packs_ws on skill_packs (workspace_id, channel_id);

alter table skill_packs enable row level security;
create policy members_read on skill_packs for select using (nm_is_member(workspace_id));

-- skills gain pack membership + an independent on/off switch
alter table skills add column pack_id uuid references skill_packs (id) on delete cascade; -- null = standalone "Other"
alter table skills add column enabled boolean not null default true;

-- pack-scope the active-name uniqueness so two packs may each carry e.g. "code-review"
-- (coalesce keeps standalone skills sharing one namespace via the nil uuid).
drop index skills_name_channel;
create unique index skills_name_channel_pack on skills
  (workspace_id, channel_id, coalesce(pack_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  where status = 'active' and channel_id is not null;

-- the Curator agent role (imports packs, curates the skill library)
alter type agent_role add value if not exists 'curator';
