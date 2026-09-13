-- Custom brains (user-authored model packs, docs/10 §14): named role→model maps a
-- workspace saves and activates alongside the curated packs. Workspace-scoped CONFIG,
-- deliberately NOT in the PowerSync publication (same doctrine as workspaces): clients
-- read them via GET /v1/model-packs on demand, so there is no sync-rule redeploy and no
-- client schema mirror. workspaces.active_model_pack may now hold a `custom:<uuid>` id;
-- the command handler verifies the row exists before persisting, and deleting a pack
-- resets the pointer to the 'custom' sentinel in the same transaction — a dangling
-- active id is impossible by construction.
create table if not exists custom_model_packs (
  id text primary key check (id like 'custom:%'),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  roles jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one name per workspace (case-insensitive): a duplicate is a clean 409, not a mystery twin
create unique index if not exists custom_model_packs_ws_name_idx
  on custom_model_packs (workspace_id, lower(name));
