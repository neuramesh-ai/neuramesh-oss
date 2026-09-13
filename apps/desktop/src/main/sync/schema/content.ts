// Replica tables: schedules, content_items, connectors, skills, skill_packs, whiteboards — extracted from sync.ts (track B-sync).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching client-core mirror and a sync rule — the parity test is the tripwire.
import { column, Table } from '@powersync/common';

// schedules (marketing-channel plan §4.6): the generic "run X at time T" primitive —
// the daemon minute-tick claims due rows by run_count CAS; the HQ rail + calendar read them
export const schedules = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  title: column.text,
  cadence: column.text,
  at_time: column.text,
  tz: column.text,
  weekday: column.integer,
  next_run_at: column.text,
  run_count: column.integer,
  agent_id: column.text,
  payload: column.text,
  status: column.text,
  created_by_kind: column.text,
  created_by: column.text,
  last_run_at: column.text,
  last_error: column.text,
  created_at: column.text,
});

// content items (marketing-channel plan §4.7): the calendar's atoms — agents draft,
// humans publish; external_url is the receipt once the server publishes via connectors
export const content_items = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  schedule_id: column.text,
  task_id: column.text,
  // 0115 — a draft written in a CONVERSATION rather than on a content task
  thread_id: column.text,
  platform: column.text,
  body: column.text,
  media: column.text,
  status: column.text,
  scheduled_at: column.text,
  published_at: column.text,
  external_url: column.text,
  approved_by: column.text,
  approved_at: column.text,
  created_by_kind: column.text,
  created_by: column.text,
  last_error: column.text,
  created_at: column.text,
});

// connectors (marketing-channel plan §4.8): the VISIBLE half of a workspace's social
// accounts — provider/handle/status only; sealed tokens never reach any client replica
export const connectors = new Table({
  workspace_id: column.text,
  // the room the OAuth round-trip was started from; `project_id` is what IDENTITY belongs to and
  // what the uniqueness reads (0106) — one X account per PROJECT, not per workspace.
  channel_id: column.text,
  project_id: column.text,
  provider: column.text,
  handle: column.text,
  status: column.text,
  scopes: column.text,
  connected_by: column.text,
  created_at: column.text,
});

export const skills = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  name: column.text,
  description: column.text,
  scope: column.text,
  body: column.text,
  status: column.text,
  author_kind: column.text,
  author_id: column.text,
  version: column.integer,
  pack_id: column.text,
  enabled: column.integer, // PowerSync has no boolean type — 0/1
  created_at: column.text,
  updated_at: column.text,
});

export const skill_packs = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  name: column.text,
  description: column.text,
  source_url: column.text,
  source_ref: column.text,
  version: column.text,
  origin: column.text,
  enabled: column.integer,
  status: column.text,
  step: column.text,
  progress: column.integer,
  error: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Whiteboards (0111, docs/38): Excalidraw scenes as living synced rows. scene/source are jsonb
// server-side → JSON text here (the ship_plan precedent); snapshot_svg is the still every card
// and tile renders; rev is the optimistic-concurrency guard a save carries (snapshot_rev says
// which rev the still pictures, so a renderer knows when it is stale and re-exports).
export const whiteboards = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  thread_id: column.text,
  task_id: column.text,
  title: column.text,
  scene: column.text,
  source: column.text,
  snapshot_svg: column.text,
  snapshot_rev: column.integer,
  rev: column.integer,
  archived_at: column.text,
  created_by_kind: column.text,
  created_by: column.text,
  updated_by_kind: column.text,
  updated_by: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Code sessions (0135, the mobile-cloud round): one synced row per engineering session — repo,
// branch, mode, state, the last line — so every client can LIST Code work. The machine's transcript
// stays the execution authority; this row is what a list needs and nothing a turn could replay from.
export const code_sessions = new Table({
  workspace_id: column.text,
  project_id: column.text,
  repo_id: column.text,
  repo_name: column.text,
  branch: column.text,
  title: column.text,
  mode: column.text,
  state: column.text,
  machine_id: column.text,
  created_by: column.text,
  last_line: column.text,
  changes_count: column.integer,
  checkpoints_count: column.integer,
  created_at: column.text,
  updated_at: column.text,
  ended_at: column.text,
});
