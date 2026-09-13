// Replica tables: tasks, artifacts, beats, runs, decisions — extracted from sync.ts (track B-sync).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching client-core mirror and a sync rule — the parity test is the tripwire.
import { column, Table } from '@powersync/common';

export const tasks = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  number: column.integer,
  title: column.text,
  description: column.text,
  state: column.text,
  kind: column.text,
  creator_kind: column.text,
  creator_id: column.text,
  assignee_kind: column.text,
  assignee_id: column.text,
  offered_agent_id: column.text,
  requirements: column.text,
  requirements_confirmed: column.integer,
  plan_approved_at: column.text,
  definition_of_done: column.text,
  repo_id: column.text,
  base_ref: column.text,
  branch: column.text,
  submitted_sha: column.text,
  pr_url: column.text,
  pr_number: column.integer,
  project_id: column.text,
  artifact_count: column.integer,
  // the ship gate's release plan (docs/23) — jsonb on the server, JSON text here
  ship_plan: column.text,
  // plan-first units (docs/41): the implementation plan — declared journey legs + proposed
  // subtasks + approach — jsonb on the server, JSON text here (the ship_plan precedent)
  work_plan: column.text,
  // thread-owned work (docs/41): the conversation that OWNS this unit (N:1)
  origin_thread_id: column.text,
  // subtasks (docs/24): set = this row rides that parent, rendered under it
  parent_task_id: column.text,
  // lifecycle timestamps — already in every sync stream (rules `select *`);
  // declaring them here just materializes them into the client views
  created_at: column.text,
  updated_at: column.text,
  claimed_at: column.text,
  submitted_at: column.text,
  approved_at: column.text,
  accepted_at: column.text,
  closed_at: column.text,
});

export const artifacts = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  task_id: column.text,
  message_id: column.text, // chat attachments: the message this artifact was attached to
  kind: column.text,
  name: column.text,
  mime: column.text,
  inline_content: column.text,
  size_bytes: column.integer,
  width: column.integer,
  height: column.integer,
  promoted: column.integer,
  tags: column.text, // pg text[] arrives as its JSON text — e.g. ["brand"], the rail's filter
  created_at: column.text,
});

// Beats (docs/17): per-phase agent progress steps, synced so the tracker renders in the thread.
export const beats = new Table({
  workspace_id: column.text,
  task_id: column.text,
  run_id: column.text,
  phase: column.text,
  role: column.text,
  seq: column.integer,
  title: column.text,
  status: column.text,
  started_at: column.text,
  done_at: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Runs (docs/29): the durable row behind a stretch of agent work — the ghost's synced twin.
// Legs point at their parent, so the fan-out is a foreign key, not a special case.
export const runs = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  thread_id: column.text,
  task_id: column.text,
  agent_id: column.text,
  parent_run_id: column.text,
  kind: column.text,
  title: column.text,
  state: column.text,
  step: column.text,
  // `role·model[·@specialist]` — which config a leg runs on (0103). Stored, not derived: a subagent
  // has no `agents` row, so a leg's agent_id is its PARENT's and the roster cannot answer it.
  seat: column.text,
  done: column.integer,
  total: column.integer,
  summary: column.text,
  // Shared compute (0114): WHICH member's machine served this run, and (for wake runs) the
  // message it answers — the pair the run lease is built on. Declared here or the replica has no
  // such column and any query naming it throws; the runs watches swallow onError, so that failure
  // is INVISIBLE — the Activity view and the rail simply go empty.
  machine_id: column.text,
  trigger_message_id: column.text,
  started_at: column.text,
  ended_at: column.text,
  updated_at: column.text,
});

// Decisions (docs/12 slice 2): agents' nmq question cards as first-class rows with
// authoritative open/answered state — born server-side inside POST /v1/messages,
// flipped by decision.answer/dismiss. Synced so Mission Control's queue and the
// thread cards read status instead of string-matching answer lines.
export const decisions = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  task_id: column.text,
  message_id: column.text,
  asker_kind: column.text,
  asker_id: column.text,
  question: column.text,
  options: column.text, // jsonb arrives as JSON text — the renderer parses
  allow_other: column.integer, // PowerSync has no boolean type — 0/1
  status: column.text,
  answer: column.text,
  answered_by_kind: column.text,
  answered_by_id: column.text,
  created_at: column.text,
  answered_at: column.text,
});
