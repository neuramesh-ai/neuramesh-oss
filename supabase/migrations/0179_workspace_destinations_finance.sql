-- Finance and Marketing are restricted workspace destinations. Membership is separate
-- from project rosters, which historically did not restrict human data access.
create table workspace_destination_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  destination text not null check(destination in ('finance','marketing')),
  principal_kind text not null check(principal_kind in ('human','agent')),
  principal_id uuid not null,
  added_by uuid not null references nm_users(id),
  added_at timestamptz not null default now(),
  primary key(workspace_id,destination,principal_kind,principal_id)
);
create table workspace_destination_revisions (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  destination text not null check(destination in ('finance','marketing')),
  revision bigint not null default 0,
  primary key(workspace_id,destination)
);
create table workspace_finance_links (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  session uuid not null,
  sealed_secret text not null,
  origin text not null,
  intent text not null check(intent in ('create','connect')),
  connected_by uuid not null references nm_users(id),
  updated_at timestamptz not null default now()
);
create table workspace_finance_chats (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kinshi_session uuid not null,
  title text not null,
  sealed_messages text not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
create index workspace_finance_chats_scope on workspace_finance_chats(workspace_id,kinshi_session,updated_at desc);
-- These tables are control-api only: never published to shared replicas, search or events.
alter table workspace_destination_members enable row level security;
alter table workspace_destination_revisions enable row level security;
alter table workspace_finance_links enable row level security;
alter table workspace_finance_chats enable row level security;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on workspace_destination_members,workspace_destination_revisions,workspace_finance_links,workspace_finance_chats from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on workspace_destination_members,workspace_destination_revisions,workspace_finance_links,workspace_finance_chats from authenticated;
  end if;
end $$;

create function nm_destination_access(w uuid, k text, p uuid, d text) returns boolean
language sql stable as $$
  select case when k='human' then exists(
    select 1 from workspace_members m where m.workspace_id=w and m.user_id=p and
    (m.role='owner' or exists(select 1 from workspace_destination_members g where g.workspace_id=w and g.destination=d and g.principal_kind=k and g.principal_id=p))
  ) when k='agent' then exists(
    select 1 from agents a join workspace_destination_members g on g.workspace_id=a.workspace_id and g.principal_kind='agent' and g.principal_id=a.id
    where a.id=p and a.workspace_id=w and a.retired_at is null and g.destination=d
  ) else false end
$$;

-- One classifier for snapshots, change-feed rows and direct-id authorization.
create function nm_marketing_row(w uuid, tab text, r jsonb) returns boolean language plpgsql stable as $$
declare cid uuid; tid uuid; taskid uuid; sid uuid;
begin
  if tab in ('content_items','connectors','reply_reminders') then return true; end if;
  if tab='channels' then return coalesce(r->>'kind'='marketing',false); end if;
  if coalesce(r->>'channel_id','') ~ '^[0-9a-f-]{36}$' then cid=(r->>'channel_id')::uuid; end if;
  if cid is null and coalesce(r->>'task_id','') ~ '^[0-9a-f-]{36}$' then
    taskid=(r->>'task_id')::uuid; select channel_id into cid from tasks where id=taskid and workspace_id=w;
  end if;
  if cid is null and coalesce(r->>'thread_id','') ~ '^[0-9a-f-]{36}$' then
    tid=(r->>'thread_id')::uuid; select channel_id into cid from threads where id=tid and workspace_id=w;
  end if;
  if cid is null and coalesce(r->>'schedule_id','') ~ '^[0-9a-f-]{36}$' then
    sid=(r->>'schedule_id')::uuid; select channel_id into cid from schedules where id=sid and workspace_id=w;
  end if;
  if tab='memory_blocks' and cid is null then return true; end if;
  return coalesce(exists(select 1 from channels where id=cid and workspace_id=w and kind='marketing'),false);
end $$;

create function nm_marketing_scope_for_id(target uuid) returns uuid language plpgsql stable as $$
declare rec record; table_name text;
begin
  foreach table_name in array array['channels','threads','tasks','messages','artifacts','schedules','content_items','connectors','whiteboards','runs','decisions','memory_blocks','reply_reminders'] loop
    execute format('select workspace_id,to_jsonb(t) as row from %I t where id=$1',table_name) into rec using target;
    if rec.workspace_id is not null and nm_marketing_row(rec.workspace_id,table_name,rec.row) then return rec.workspace_id; end if;
  end loop;
  return null;
end $$;
