-- Each email a person sends from NeuraMesh (docs/design/inbox-sales-2026-11/plan.md I11): the daily cap counts them by
-- the sender's address, because Gmail's own limit is per Google account, and one account can be linked in two
-- workspaces. No recipient and no text: only who sent, when, and what it answered. Rows older than two days go.
-- It is not tied to the link, so a new link does not reset the count. Server-only, like mail_links.
create table mail_sends (
  id uuid primary key default gen_random_uuid(),
  sender text not null,
  workspace_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('reply','email')),
  ref text not null,
  sent_at timestamptz not null default now()
);
create index mail_sends_sender on mail_sends (sender, sent_at);
alter table mail_sends enable row level security;
revoke all on mail_sends from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on mail_sends from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on mail_sends from anon; end if;
end $$;
