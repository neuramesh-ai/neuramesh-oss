-- message boards: schema `boards` for the nm-boards service (docs/design/message-boards-2026-11/api.md).
--
-- this file makes no role and no login. the bootstrap job makes the group role nm_boards, and the
-- service signs in as a login that is only a member of it. boards.grant_service_role() holds every
-- grant of that role: it runs at the end of this file, it does nothing while the role does not exist,
-- and the owner of schema boards must run it again after the role exists.
--
-- the walls: nm_boards gets no right on schema public and reads core facts only through the boards.v_*
-- views. nm_runtime gets no right on schema boards. there are no default privileges, so a later
-- migration that adds an object to schema boards must add its grant to boards.grant_service_role()
-- and call the function again.

create schema boards;

-- a view runs with the rights of its owner. the role that applies this file must pass row level
-- security on the four core tables, or the views show no row to the service.
do $$
declare
  tab text;
begin
  foreach tab in array array['nm_users', 'workspaces', 'workspace_members', 'agents'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = tab
        and ((select r.rolsuper or r.rolbypassrls from pg_roles r where r.rolname = current_user)
          or (not c.relforcerowsecurity and pg_has_role(current_user, c.relowner, 'USAGE')))
    ) then
      raise exception 'message boards: role % cannot read public.% past row level security', current_user, tab;
    end if;
  end loop;
end $$;

create view boards.v_users as
  select id, clerk_user_id from public.nm_users;

create view boards.v_workspaces as
  select id, name, slug, plan from public.workspaces;

create view boards.v_members as
  select workspace_id, user_id, role, display_name from public.workspace_members;

create view boards.v_agents as
  select id, workspace_id, name, role::text as role, emoji, retired_at from public.agents;

-- one line of visible text: no control character and no bidi control
create function boards.is_plain(t text) returns boolean language sql immutable parallel safe as $$
  select t operator(pg_catalog.!~) '[\u0001-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]'
$$;

create table boards.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(name) between 1 and 80 and boards.is_plain(name)),
  description text not null default '' check (length(description) <= 500),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  -- null shows all history to the public
  public_since timestamptz,
  noindex boolean not null default true,
  -- the creator. it gives no right: only a grant does
  owner_user_id uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table boards.topics (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards.boards (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title text not null check (length(title) between 1 and 80 and boards.is_plain(title)),
  description text not null default '' check (length(description) <= 500),
  summary_md text not null default '' check (length(summary_md) <= 4000),
  summary_updated_by uuid,
  summary_updated_at timestamptz,
  archived_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (board_id, slug)
);

create table boards.principals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  kind text not null check (kind in ('member', 'nm_agent', 'external')),
  user_id uuid,
  agent_id uuid,
  label text not null check (length(label) between 1 and 80 and boards.is_plain(label)),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check ((kind = 'member') = (user_id is not null)),
  check ((kind = 'nm_agent') = (agent_id is not null))
);
create unique index principals_member_uq on boards.principals (workspace_id, user_id) where kind = 'member';
create unique index principals_agent_uq on boards.principals (workspace_id, agent_id) where kind = 'nm_agent';
-- the rows of one person in every workspace: whoami and the count of messages that wait start here
create index principals_member_user on boards.principals (user_id) where kind = 'member';

-- only an hmac of the full token is here, never the secret
create table boards.tokens (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references boards.principals (id) on delete cascade,
  lookup_id text not null unique check (lookup_id ~ '^[a-z0-9]{8}$'),
  token_hmac bytea not null,
  last4 text not null,
  managed boolean not null,
  -- a managed credential belongs to one agent on one machine
  machine_id uuid,
  expires_at timestamptz not null,
  allow_action_requests boolean not null default false,
  ip_allowlist cidr[],
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  last_used_at timestamptz,
  last_used_ip inet,
  last_used_client text,
  check (machine_id is null or managed)
);
create index tokens_principal_idx on boards.tokens (principal_id);

create table boards.grants (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references boards.principals (id) on delete cascade,
  board_id uuid not null references boards.boards (id) on delete cascade,
  -- null is the whole board
  topic_id uuid references boards.topics (id) on delete cascade,
  perm text not null check (perm in ('read', 'post', 'manage')),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  suspended_at timestamptz
);
create unique index grants_uq on boards.grants (principal_id, board_id, coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index grants_board_idx on boards.grants (board_id);

create function boards.grants_guard() returns trigger
  language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  p_kind text;
  p_workspace uuid;
  b_workspace uuid;
begin
  select kind, workspace_id into p_kind, p_workspace from boards.principals where id = new.principal_id;
  select workspace_id into b_workspace from boards.boards where id = new.board_id;
  if p_workspace is distinct from b_workspace then
    raise exception 'a grant joins a principal and a board of one workspace' using errcode = 'check_violation';
  end if;
  if new.perm = 'manage' and p_kind <> 'member' then
    raise exception 'manage can only be granted to a member' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger grants_guard before insert or update on boards.grants
  for each row execute function boards.grants_guard();

create table boards.messages (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards.boards (id) on delete cascade,
  topic_id uuid not null references boards.topics (id) on delete cascade,
  kind text not null check (kind in ('note', 'summary', 'plan', 'handoff', 'decision', 'action_request')),
  title text not null default '' check (length(title) <= 200 and boards.is_plain(title)),
  body_md text not null check (octet_length(body_md) between 1 and 32768),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  author_principal_id uuid not null references boards.principals (id),
  author_label text not null,
  author_type text not null check (author_type in ('member', 'neuramesh_agent', 'external_agent')),
  client text,
  state text check (state in ('open', 'acked', 'pending', 'approved', 'declined')),
  acked_by uuid references boards.principals (id),
  acked_at timestamptz,
  ack_note text check (ack_note is null or length(ack_note) <= 500),
  decided_by uuid,
  decided_at timestamptz,
  redactions int not null default 0,
  quarantined_at timestamptz,
  quarantined_by uuid,
  -- a key that the client makes: one message for each author and key
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || body_md)) stored,
  check (
    (kind = 'handoff' and state in ('open', 'acked'))
    or (kind = 'action_request' and state in ('pending', 'approved', 'declined'))
    or (kind not in ('handoff', 'action_request') and state is null)
  )
);
create index messages_topic_idx on boards.messages (topic_id, created_at desc);
create index messages_board_idx on boards.messages (board_id, created_at desc);
create index messages_search_idx on boards.messages using gin (search);
create index messages_author_idx on boards.messages (author_principal_id);
create index messages_acked_by_idx on boards.messages (acked_by) where acked_by is not null;
create unique index messages_idempotency_uq on boards.messages (author_principal_id, idempotency_key)
  where idempotency_key is not null;
create index messages_waiting_idx on boards.messages (board_id, created_at desc)
  where (kind = 'handoff' and state = 'open') or (kind = 'action_request' and state = 'pending');

-- never a message body, a title or a secret
create table boards.access_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  workspace_id uuid,
  principal_id uuid,
  principal_kind text check (principal_kind in ('member', 'nm_agent', 'external', 'anonymous')),
  token_id uuid,
  actor_label text not null,
  action text not null,
  board_id uuid,
  topic_id uuid,
  message_id uuid,
  items int,
  result smallint not null,
  ip inet,
  anon_ip_hash text,
  client text,
  request_id text,
  flags text[] not null default '{}'
);
create index access_log_ws_at_idx on boards.access_log (workspace_id, at desc);
create index access_log_board_at_idx on boards.access_log (board_id, at desc);
create index access_log_token_at_idx on boards.access_log (token_id, at desc);
create index access_log_at_idx on boards.access_log using brin (at);

-- the service can add and read log rows and cannot change or delete them: this function is the only
-- way out for an old row
create function boards.purge_access_log(keep_days integer) returns bigint
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  n bigint;
begin
  if keep_days is null or keep_days < 30 then
    raise exception 'the access log keeps 30 days or more' using errcode = 'check_violation';
  end if;
  delete from boards.access_log where at < now() - make_interval(days => keep_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function boards.purge_access_log(integer) from public;

create table boards.rate_counters (
  key text not null,
  window_start timestamptz not null,
  n int not null default 0,
  primary key (key, window_start)
);

-- lifecycle: a core row that goes takes its access with it. security definer, so the core write
-- needs no right on schema boards. these functions must not raise: an error here stops the core write.
create function boards.on_agent_gone() returns trigger
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  update boards.tokens t set revoked_at = now()
    from boards.principals p
    where p.id = t.principal_id and p.kind = 'nm_agent' and p.workspace_id = old.workspace_id
      and p.agent_id = old.id and t.revoked_at is null;
  delete from boards.grants g using boards.principals p
    where p.id = g.principal_id and p.kind = 'nm_agent' and p.workspace_id = old.workspace_id
      and p.agent_id = old.id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create function boards.on_member_gone() returns trigger
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  delete from boards.grants g using boards.principals p
    where p.id = g.principal_id and p.kind = 'member' and p.workspace_id = old.workspace_id
      and p.user_id = old.user_id;
  update boards.grants g set suspended_at = now()
    from boards.principals p, boards.boards b
    where p.id = g.principal_id and p.kind = 'external' and b.id = g.board_id
      and b.workspace_id = old.workspace_id and g.granted_by = old.user_id and g.suspended_at is null;
  return old;
end $$;

create function boards.on_workspace_gone() returns trigger
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  delete from boards.boards where workspace_id = old.id;
  -- a principal row cannot go while a message names it
  delete from boards.messages m using boards.principals p
    where p.workspace_id = old.id and m.author_principal_id = p.id;
  update boards.messages m set acked_by = null
    from boards.principals p
    where p.workspace_id = old.id and m.acked_by = p.id;
  delete from boards.principals where workspace_id = old.id;
  delete from boards.access_log where workspace_id = old.id;
  return old;
end $$;

revoke all on function boards.on_agent_gone(), boards.on_member_gone(), boards.on_workspace_gone() from public;

create trigger nm_boards_agent_retired after update of retired_at on public.agents
  for each row when (new.retired_at is not null) execute function boards.on_agent_gone();
create trigger nm_boards_agent_deleted after delete on public.agents
  for each row execute function boards.on_agent_gone();
create trigger nm_boards_member_left after delete on public.workspace_members
  for each row execute function boards.on_member_gone();
create trigger nm_boards_workspace_deleted after delete on public.workspaces
  for each row execute function boards.on_workspace_gone();

-- every right of the service role, and nothing more. security invoker: only the owner of schema
-- boards can give these rights. safe to run again.
create function boards.grant_service_role(service_role text default 'nm_boards') returns boolean
  language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if to_regrole(service_role) is null then
    return false;
  end if;
  execute format('grant usage on schema boards to %I', service_role);
  execute format('grant select on boards.v_users, boards.v_workspaces, boards.v_members, boards.v_agents to %I', service_role);
  execute format('grant select, insert, update on boards.boards, boards.topics, boards.principals, boards.tokens, boards.messages to %I', service_role);
  execute format('grant select, insert, update, delete on boards.grants, boards.rate_counters to %I', service_role);
  execute format('grant select, insert on boards.access_log to %I', service_role);
  execute format('grant execute on function boards.purge_access_log(integer) to %I', service_role);
  return true;
end $$;
revoke all on function boards.grant_service_role(text) from public;

do $$
begin
  perform boards.grant_service_role();
end $$;
