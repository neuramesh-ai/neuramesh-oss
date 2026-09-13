// Replica tables: machines, agents, agent_channels, workspace_members, policies — extracted from sync.ts (track B-sync).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching client-core mirror and a sync rule — the parity test is the tripwire.
import { column, Table } from '@powersync/common';

export const machines = new Table({
  workspace_id: column.text,
  // Shared compute (0114): a workspace's agents run on MEMBERS' machines, so a host has to be
  // able to answer "whose machine is that, and can it serve this runtime?" about its PEERS —
  // both are inputs to the origin-affinity policy in shared/src/compute.ts. The sync rule is
  // `select * from machines`, so these already arrive; they just had to be declared to be read.
  owner_user_id: column.text,
  runtimes: column.text, // jsonb array, surfaced as text by the SQLite replica
  name: column.text,
  platform: column.text,
  // local | member | runner (0126) — the browser client resolves the workspace's RUNNER to
  // register its starter crew against, since a browser has no machine of its own
  kind: column.text,
  daemon_version: column.text,
  last_seen_at: column.text,
});

export const agents = new Table({
  workspace_id: column.text,
  machine_id: column.text,
  name: column.text,
  role: column.text,
  model: column.text,
  runtime: column.text,
  model_source: column.text, // 'pack' | 'manual' — drives the per-agent "pinned" badge + pack-apply targeting
  emoji: column.text,
  card: column.text,
  kind: column.text,
  endpoint_url: column.text,
  status: column.text,
  retired_at: column.text, // soft retirement (0054): null = active; selection paths filter on it
  // The two agent strings (0110), two readers: `description` ROUTES — what it does + when to
  // route work here, read by the orchestrator in list_agents and published on the A2A card;
  // `brief` INSTRUCTS — how it works, injected into every turn. Surfaced as "Instructions".
  description: column.text,
  brief: column.text,
});

export const agent_channels = new Table({ agent_id: column.text, channel_id: column.text, created_by_kind: column.text, created_by: column.text, created_at: column.text });

// `compute` (0118): the member's compute choice — read by the wake gate for the ORIGIN member
export const workspace_members = new Table({ workspace_id: column.text, user_id: column.text, role: column.text, display_name: column.text, compute: column.text });

// Policies (agent permission engine, Phase 1): human-configured allow/ask/deny rules the
// daemon reads from the replica to gate agent tool calls. selector jsonb → JSON text; locked 0/1.
export const policies = new Table({
  workspace_id: column.text,
  scope: column.text,
  project_id: column.text,
  channel_id: column.text,
  agent_id: column.text,
  capability: column.text,
  selector: column.text,
  verdict: column.text,
  rationale: column.text,
  locked: column.integer,
  created_by_kind: column.text,
  created_by_id: column.text,
  created_at: column.text,
  updated_at: column.text,
});
