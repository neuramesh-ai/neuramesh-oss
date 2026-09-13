-- Provider credentials (BYOK). Deliberately NOT in the powersync publication:
-- tokens never replicate to clients; daemons fetch at spawn via control-api,
-- UIs only ever see masked metadata. RLS on, no policies => service-role only.
create table provider_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  scope text not null check (scope in ('workspace', 'agent')),
  agent_id uuid references agents (id) on delete cascade,
  provider text not null default 'anthropic',
  token text not null,
  set_by uuid not null,
  updated_at timestamptz not null default now(),
  check ((scope = 'agent') = (agent_id is not null))
);

create unique index provider_credentials_workspace_scope
  on provider_credentials (workspace_id, provider) where scope = 'workspace';
create unique index provider_credentials_agent_scope
  on provider_credentials (agent_id, provider) where scope = 'agent';

alter table provider_credentials enable row level security;
