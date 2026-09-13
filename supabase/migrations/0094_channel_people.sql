-- Channel people membership. Rooms are the unit of work, so the left rail now answers
-- "who is in THIS room" for humans exactly as it does for agents: the rail lists channel
-- members, and the People "+" opens a picker of the workspace to add from.
--
-- channel_members has existed since 0001 but was never published, never synced and never
-- written to (zero rows). This wires it up.
--
-- SCOPE: this is a ROSTER, not an ACL. It changes what the rail lists, not what anyone is
-- permitted to read — the existing RLS policy and the workspace-wide sync rules are
-- untouched, and mentions stay workspace-wide. Making room membership gate visibility is a
-- separate, security-shaped change that would need its own review.
--
-- The backfill matters: without it every existing room would render zero people the moment
-- the rail starts filtering, which reads as data loss. Seeding every current workspace member
-- into every room in their workspace preserves today's behaviour exactly, and divergence
-- starts from the first deliberate add or remove.

-- PowerSync keys every replicated row by a single `id` (see 0008) — a composite-PK table
-- replicates with row_id='' and collapses to one visible row. The PG suite enforces this for
-- every published table.
alter table channel_members add column id uuid not null default gen_random_uuid();
create unique index channel_members_id on channel_members (id);

-- who brought them in, for the room's papertrail (mirrors 0093 on agent_channels). Nullable:
-- the rows the backfill creates below have no actor, and render actor-less.
alter table channel_members add column created_by uuid references nm_users (id) on delete set null;

-- Backfill: every existing workspace member belongs to every room in their workspace, which
-- is precisely what the app showed before this migration.
insert into channel_members (channel_id, user_id)
select c.id, wm.user_id
  from channels c
  join workspace_members wm on wm.workspace_id = c.workspace_id
on conflict do nothing;

-- The publication entry lives in its own *publish* migration (0095), per convention: the CI
-- bootstrap skips publication migrations BY FILENAME and creates the publication wholesale at
-- the end (dev/stack/init/99-publication.sql), so an `alter publication` inside a normally-named
-- migration runs before the publication exists and fails.

comment on column channel_members.created_by is
  'nm_users.id that ran channel.add_person. Null for the 0094 backfill and for a room''s creator seed.';
