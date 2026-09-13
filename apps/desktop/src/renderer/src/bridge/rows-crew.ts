// Synced-row shapes (rows-crew) — extracted from App.tsx (modularization track A1).
// Pure types: what the renderer receives over the NMBridge watches/reads.

export interface MachineRow {
  id: string;
  name: string;
  platform: string;
  daemon_version: string;
  last_seen_at: string | null;
  /** whose machine this is (0114) — shared compute is defined per member, not per workspace */
  owner_user_id?: string | null;
  /** local | member | runner (0126). NOT NULL DEFAULT 'local' server-side, so an absent value
   *  is a laptop — the setup tracker reads it to tell cloud compute from a desktop daemon. */
  kind?: string | null;
  /** what it can serve right now, as a JSON array string from the replica. Empty means it has no
   *  login or key for anything, so peers step in rather than wait on it. */
  runtimes?: string | null;
}

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  model: string;
  runtime?: string | null;
  model_source?: string | null; // 'pack' (managed by the active pack) | 'manual' (human-pinned)
  emoji?: string | null; // human-picked persona face; null → derive from name
  card?: string | null; // A2A 1.0 Agent Card (JSON string)
  kind?: string | null; // 'local' | 'remote'
  status: string;
  /** WHERE IT WAS REGISTERED — provenance only since 0114. Any member machine with the runtime
   *  may serve this agent's work; do not read this as "where it runs". */
  machine_id?: string | null;
  /** where it is working RIGHT NOW: the machine holding its open run, or null when idle (0114) */
  hosted_on?: string | null;
  retired_at?: string | null; // soft retirement (0054): set → out of the active roster; rehire clears it
  // The two strings (0110), two readers. `description` ROUTES — third person, what this agent
  // does and when to send work here; the orchestrator reads it in list_agents, the hover card
  // shows it, the A2A card publishes it. `brief` INSTRUCTS — how the agent works, injected into
  // every turn it takes. Surfaced as "Instructions" everywhere (the column kept its old name).
  description?: string | null;
  brief?: string | null;
  channels: string | null; // comma-joined channel SLUGS — display only (an agent can be in two same-slug rooms)
  channel_ids: string | null; // comma-joined channel IDS — the membership key (slugs collide across projects)
}

export interface LogRow {
  id: number;
  ts: string;
  run_id: string | null;
  agent_id: string;
  agent_name: string;
  task_id: string | null;
  task_number: number | null;
  channel_slug: string | null;
  kind: string;
  phase: string | null;
  summary: string;
  detail: string | null;
  level: string;
  tokens: number | null;
  tool_use_id: string | null; // links a tool 'call' to its 'result' — pairs them even across parallel calls
}

// one activity run (a channel reply, a task attempt, a sweep, a review) — the popup's session unit
export interface RunRow {
  run_id: string;
  agent_id: string;
  started_at: string;
  last_at: string;
  rows: number;
  tokens: number;
  worst_level: string;
  task_number: number | null;
  channel_slug: string | null;
  trigger: string;
}

export interface MemberRow {
  user_id: string;
  role: string;
  display_name: string | null;
  /** compute choice (0118): {machine, agents} jsonb as text — where this member's requests run */
  compute?: string | null;
}

/** A workspace this identity belongs to (0113). Membership is a SET — the replica streams every
 *  one of them — and which you are standing in is a persisted choice, not the oldest by accident. */
export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  role?: string;
  memberCount?: number;
  plan?: string;
}

/** An invitation waiting on your verified address. Answering it is what creates the membership;
 *  signing in only surfaces it. */
export interface PendingInvite {
  inviteId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
  inviterEmail: string | null;
  inviterName: string | null;
  createdAt: string;
  expiresAt: string;
}
