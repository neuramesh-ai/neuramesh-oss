-- Agent permission policies (Phase 1): the persisted, human-configured rules the
-- deterministic enforcer (packages/shared/src/policy.ts) gates every agent tool call
-- against — allow / ask / deny per capability, scoped workspace→project→channel→agent.
-- Rows here are OVERRIDES/additions on top of the code baseline (defaultBaselineRules);
-- the daemon merges the two and evaluates most-specific-wins with locked invariants.
-- Enforced, not prompted: a prompt-injected agent cannot exceed its policy because the
-- gate is plain code and these rules came from a human, not the agent's context.
-- New synced table → publication (0069_publish_policies.sql, prod; dev/CI lists it in
-- dev/stack/init/99-publication.sql) + the sync rule (dev/stack/powersync/sync-config.yaml).
create table policies (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  scope           text not null,                                    -- workspace|project|channel|agent|task
  project_id      uuid references projects (id) on delete cascade,  -- set when scope narrows past workspace
  channel_id      uuid references channels (id) on delete cascade,
  agent_id        uuid references agents (id) on delete cascade,
  capability      text not null,                                    -- PolicyCapability
  selector        jsonb not null default '{}'::jsonb,               -- PolicySelector (see shared/policy.ts)
  verdict         text not null check (verdict in ('allow', 'ask', 'deny')),
  rationale       text not null default '',
  locked          boolean not null default false,                   -- workspace hard invariant
  created_by_kind actor_kind not null,
  created_by_id   uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index policies_ws_cap on policies (workspace_id, capability);

alter table policies enable row level security;
create policy members_read on policies for select using (nm_is_member(workspace_id));
