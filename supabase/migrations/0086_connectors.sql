-- Connectors (marketing-channel plan §4.8): a workspace's social accounts. The visible
-- half (this table) is synced — provider, handle, status — so cards and rails render
-- from the replica. The SECRETS half lives in connector_secrets, which is NEVER added
-- to the powersync publication and never selected by any sync rule: tokens are sealed
-- (AES-256-GCM under NM_CONNECTOR_KEY) server-side and only the control-api's publish
-- pass unseals them. This is the one written-down BYOK deviation (George, round 1):
-- code + model keys stay on the machine; social tokens are workspace assets held
-- server-side so scheduled publishing survives a closed laptop.
create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid references channels(id) on delete set null,
  provider text not null check (provider in ('x')),
  handle text not null default '',
  status text not null default 'pending' check (status in ('pending', 'connected', 'revoked')),
  scopes text not null default '',
  connected_by text not null default '',
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);
create index if not exists connectors_ws_idx on connectors(workspace_id);

create table if not exists connector_secrets (
  connector_id uuid primary key references connectors(id) on delete cascade,
  ciphertext text not null,
  created_at timestamptz not null default now()
);
