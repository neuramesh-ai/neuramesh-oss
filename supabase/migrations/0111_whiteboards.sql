-- Whiteboards (docs/38): Excalidraw scenes as first-class synced rows — the thinking surface
-- humans sketch on and the first diagram surface agents can draw to (create_whiteboard).
--
-- One row is one living board: `scene` is the Excalidraw elements JSON (jsonb → JSON text on
-- clients, the ship_plan precedent), `snapshot_svg` is the exported still every card and tile
-- renders (no live canvas ever mounts in a list), and `source` holds an agent's pending
-- mermaid/element-skeleton until the first desktop to render it materializes the scene
-- (conversion needs a DOM, so the daemon never renders — docs/38 §4).
--
-- `rev` is the optimistic-concurrency guard: every save carries the rev it built on, the server
-- keeps the highest, and a stale write is WHITEBOARD_STALE — LWW with no silent clobber.
-- `snapshot_rev` records which rev the snapshot pictures, so a renderer knows a still is stale.
--
-- Descriptive, never gating: no FSM edge depends on a whiteboard (the beats/runs stance).
-- New synced table → also joins the powersync publication (0112_publish_whiteboards.sql, prod)
-- and the sync rules (dev/stack + the deploy step). Mirrors 0096_runs.
create table whiteboards (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  channel_id     uuid not null references channels (id) on delete cascade,  -- its filing + the agent ACL boundary
  thread_id      uuid references threads (id) on delete set null,           -- provenance: the session it was born in
  task_id        uuid references tasks (id) on delete set null,             -- provenance: the task it evidences
  title          text not null default 'Untitled board',
  scene          jsonb,                                                     -- Excalidraw elements + appState subset; null until materialized
  source         jsonb,                                                     -- pending agent source: { kind: 'mermaid'|'elements', value: text }
  snapshot_svg   text,                                                      -- exported still for cards/tiles; regenerated on save
  snapshot_rev   integer not null default 0,                                -- the rev the snapshot pictures
  rev            integer not null default 1,                                -- optimistic concurrency; server keeps the highest
  archived_at    timestamptz,
  created_by_kind actor_kind not null,
  created_by     uuid not null,
  updated_by_kind actor_kind,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- the two reads: the Whiteboards destination (scope knob = workspace or channel), newest first
create index whiteboards_ws on whiteboards (workspace_id, updated_at desc);
create index whiteboards_channel on whiteboards (channel_id, updated_at desc);

-- RLS on from birth (the 0100 lesson — CI enforces this on every public table): no policy =
-- deny-all for anon/authenticated, the right default; the control-api writes as table owner
-- and PowerSync replicates through its own role, so neither is affected.
alter table whiteboards enable row level security;
