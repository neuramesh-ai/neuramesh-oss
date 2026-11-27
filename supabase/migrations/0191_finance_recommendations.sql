-- Finance recommendations (docs/design/finance-overview-2026-11/plan.md): what a member addressed or dismissed,
-- shared by the workspace, with who and when. The id is an HMAC of the recommendation's key, because the key names
-- merchants and categories. The title is sealed like a Finance chat. Server-only, never part of sync_changes.
create table workspace_finance_recommendation_actions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kinshi_session uuid not null,
  id text not null,
  month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sealed_title text not null,
  action text not null check(action in ('addressed','dismissed')),
  actor_id uuid not null references nm_users(id) on delete cascade,
  at timestamptz not null default now(),
  primary key(workspace_id,kinshi_session,id)
);
create index finance_recommendation_actions_month on workspace_finance_recommendation_actions(workspace_id,kinshi_session,month,at desc);
alter table workspace_finance_recommendation_actions enable row level security;
revoke all on workspace_finance_recommendation_actions from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on workspace_finance_recommendation_actions from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on workspace_finance_recommendation_actions from anon; end if;
end $$;
