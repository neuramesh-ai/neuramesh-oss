-- The private Inbox chat (docs/design/inbox-sales-2026-11/plan.md I16): a person's conversations with rex about
-- their own mail, answered on the API. Only that person reads them. A chat belongs to its link, so removing the
-- link removes the chats, and every word in them that came from the mail. Server-only, like mail_links.
create table inbox_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('google')),
  title text not null default '',
  messages jsonb not null default '[]'::jsonb,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, user_id, provider) references mail_links (workspace_id, user_id, provider) on delete cascade
);
create index inbox_chats_owner on inbox_chats (workspace_id, user_id, provider, updated_at desc);
alter table inbox_chats enable row level security;
revoke all on inbox_chats from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on inbox_chats from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on inbox_chats from anon; end if;
end $$;
