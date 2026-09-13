-- Auth-provider migration, slice 1 (docs/decisions 2026-06-17): decouple identity
-- from Supabase auth so we can swap to Clerk WITHOUT a schema-wide uuid->text change.
-- `nm_users` maps the auth provider's user id (the JWT `sub`) to a stable internal
-- uuid that every user FK already references: clerk_user_id holds the provider sub
-- (a Clerk user id in prod, the user uuid-as-text for dev/legacy), id is the uuid.
-- A Clerk JWT template sets `sub` = nm_users.id, so PowerSync sync rules + RLS stay
-- UNCHANGED (they key on sub) — the only moving part is this mapping table.
create table nm_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  email text,
  created_at timestamptz not null default now()
);

-- backfill existing identities so nothing breaks: every current user keeps their
-- uuid as nm_users.id, with clerk_user_id = that uuid as text (= the dev/legacy JWT
-- sub), so the unchanged sync rules + RLS keep resolving rows for them.
insert into nm_users (id, clerk_user_id, email)
  select id, id::text, email from auth.users
  on conflict (id) do nothing;

-- repoint the user FKs from Supabase's auth.users to nm_users, so a Clerk user (who
-- has no auth.users row) can own + join workspaces. Integrity is preserved: every
-- uuid currently referenced was just backfilled into nm_users. (Inline single-column
-- FKs are named <table>_<column>_fkey by Postgres.)
alter table workspaces        drop constraint if exists workspaces_created_by_fkey,     add constraint workspaces_created_by_fkey     foreign key (created_by)    references nm_users (id);
alter table workspace_members drop constraint if exists workspace_members_user_id_fkey, add constraint workspace_members_user_id_fkey foreign key (user_id)       references nm_users (id) on delete cascade;
alter table channel_members   drop constraint if exists channel_members_user_id_fkey,   add constraint channel_members_user_id_fkey   foreign key (user_id)       references nm_users (id) on delete cascade;
alter table machines          drop constraint if exists machines_owner_user_id_fkey,    add constraint machines_owner_user_id_fkey    foreign key (owner_user_id) references nm_users (id);
