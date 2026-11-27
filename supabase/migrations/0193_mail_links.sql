-- A person's Google link for Inbox (docs/design/inbox-sales-2026-11/plan.md I1): one per person per workspace.
-- The token bundle is a KMS envelope bound to (workspace, user, provider), so a row copied onto another person
-- does not open (mail-link.ts). Person-owned and server-only: never part of sync_changes, never a connectors row.
create table mail_links (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references nm_users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  email text not null,
  scopes text not null,
  status text not null default 'connected' check (status in ('connected','reauth_required')),
  key_ref text not null,
  wrapped_key bytea not null,
  iv bytea not null,
  tag bytea not null,
  ciphertext bytea not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, provider)
);
alter table mail_links enable row level security;
revoke all on mail_links from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on mail_links from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on mail_links from anon; end if;
end $$;
