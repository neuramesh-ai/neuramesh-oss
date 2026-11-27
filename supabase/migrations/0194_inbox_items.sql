-- rex's work on a person's inbox (docs/design/inbox-sales-2026-11/plan.md I2, I3): the group, the reason line and
-- the draft for each Gmail thread. The mail itself is never stored: the API reads it live with the person's link.
-- An item belongs to its link, so removing the link removes rex's work too. Server-only, like mail_links.
create table inbox_items (
  workspace_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('google')),
  thread_id text not null check (thread_id ~ '^[0-9a-f]{1,32}$'),
  message_id text not null,
  bucket text not null check (bucket in ('reply','fyi','bulk')),
  reason text not null default '',
  draft text,
  status text not null default 'open' check (status in ('open','no_reply','sent')),
  sorted_by text not null check (sorted_by in ('rule','model')),
  sorted_at timestamptz not null default now(),
  primary key (workspace_id, user_id, provider, thread_id),
  foreign key (workspace_id, user_id, provider) references mail_links (workspace_id, user_id, provider) on delete cascade
);
alter table inbox_items enable row level security;
revoke all on inbox_items from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on inbox_items from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on inbox_items from anon; end if;
end $$;

-- the sort's own facts on the link: who opened Inbox lately (the schedule sorts only for them), and the claim that
-- keeps two sorts of one inbox from running at once
alter table mail_links add column inbox_opened_at timestamptz, add column sort_claimed_at timestamptz;
