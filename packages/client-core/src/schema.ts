import { column, Schema, Table } from '@powersync/common';

// The client-side mirror of the 15 synced tables. This is the ONE definition the
// mobile app opens PowerSync with; a parity test (test/schema.test.ts) reads the
// desktop schema (apps/desktop/src/main/sync.ts) and fails if the two ever drift.
// Kept as plain data so both the runtime Schema and the drift check derive from a
// single source. PowerSync has no boolean type — flags are integer (0/1).
export const TABLE_COLUMNS = {
  // created_at + created_by* feed the room's papertrail (0093) — the intro block derives
  // "geo created this channel" from synced rows, so it reads offline like the rest of the feed.
  channels: { workspace_id: 'text', slug: 'text', topic: 'text', project_id: 'text', kind: 'text', marketing: 'text', created_by_kind: 'text', created_by: 'text', created_at: 'text' },
  projects: { workspace_id: 'text', channel_id: 'text', slug: 'text', name: 'text', description: 'text', status: 'text', is_default: 'integer', auto_open_pr: 'integer', run_ci_before_merge: 'integer', ship_gate: 'integer', website: 'text', logo_url: 'text', model_pack: 'text' },
  // root_message_id, birth_mode and birth_brain are LOCAL-ONLY transport columns: a send carries them on the
  // outgoing row so uploadData can pass them to /v1/messages — the root a reply hangs off
  // (docs/31) and the composer's Tasks toggle (docs/34). The server keeps BOTH on `threads`, so
  // sync never writes either; they are mirrored only so the desktop/mobile schemas stay strictly
  // equal. `birth_mode`, not thread_mode: `channels.thread_mode` above is the unrelated docs/20
  // view lens, and one grep returning both would be a trap.
  messages: { workspace_id: 'text', channel_id: 'text', task_id: 'text', thread_id: 'text', root_message_id: 'text', birth_mode: 'text', birth_brain: 'text', birth_machine: 'text', birth_origin: 'text', author_kind: 'text', author_id: 'text', body: 'text', created_at: 'text', pinned: 'integer' },
  // root_message_id (docs/31): the room message a thread hangs off — the root stays in the feed
  // mode (docs/34): 'tasks' (the orchestrator triages this into board work) or 'chat' (the
  // agents answer here and nothing reaches the board). Frozen at birth; moved only by a human.
  // brain_override (docs/10 §15): role → model for THIS conversation, jsonb server-side and text
  // here. PowerSync DROPS any column the local schema does not declare, so an unmirrored column
  // syncs to nothing and the override would silently never apply.
  // machine_id + origin (0134, rule D9): where the session was designated to run and which client bore it — the thread head's toks
  threads: { workspace_id: 'text', channel_id: 'text', title: 'text', description: 'text', created_by: 'text', task_id: 'text', root_message_id: 'text', mode: 'text', brain_override: 'text', schedule_id: 'text', machine_id: 'text', origin: 'text', archived_at: 'text', settled_at: 'text', created_at: 'text', updated_at: 'text' },
  tasks: {
    workspace_id: 'text', channel_id: 'text', number: 'integer', title: 'text', description: 'text', state: 'text', kind: 'text',
    creator_kind: 'text', creator_id: 'text', assignee_kind: 'text', assignee_id: 'text', offered_agent_id: 'text',
    requirements: 'text', requirements_confirmed: 'integer', plan_approved_at: 'text', definition_of_done: 'text', repo_id: 'text', base_ref: 'text',
    branch: 'text', submitted_sha: 'text', pr_url: 'text', pr_number: 'integer', project_id: 'text', artifact_count: 'integer', ship_plan: 'text', parent_task_id: 'text', work_plan: 'text', origin_thread_id: 'text',
    created_at: 'text', updated_at: 'text', claimed_at: 'text', submitted_at: 'text', approved_at: 'text', accepted_at: 'text', closed_at: 'text',
  },
  repos: { workspace_id: 'text', provider: 'text', org_name: 'text', name: 'text', default_branch: 'text', clone_url: 'text', local_path: 'text' },
  // the repo→project link (0106/0107). Without it the replica cannot tell whose checkout a
  // repo is, so every project-scoped repo question had to guess.
  project_repos: { project_id: 'text', repo_id: 'text', is_primary: 'integer' },
  artifacts: { workspace_id: 'text', channel_id: 'text', task_id: 'text', message_id: 'text', kind: 'text', name: 'text', mime: 'text', inline_content: 'text', size_bytes: 'integer', width: 'integer', height: 'integer', promoted: 'integer', tags: 'text', created_at: 'text' },
  beats: { workspace_id: 'text', task_id: 'text', run_id: 'text', phase: 'text', role: 'text', seq: 'integer', title: 'text', status: 'text', started_at: 'text', done_at: 'text', created_at: 'text', updated_at: 'text' },
  // runs (docs/29): the durable row behind a stretch of agent work. THE reason liveness works
  // on the phone at all — the desktop ghost is local IPC, a run is a synced row.
  runs: {
    workspace_id: 'text', channel_id: 'text', thread_id: 'text', task_id: 'text', agent_id: 'text',
    parent_run_id: 'text', kind: 'text', title: 'text', state: 'text', step: 'text', seat: 'text',
    // shared compute (0114): whose machine served this run, and the message a wake answers —
    // the pair the run lease is built on
    machine_id: 'text', trigger_message_id: 'text',
    done: 'integer', total: 'integer', summary: 'text', started_at: 'text', ended_at: 'text', updated_at: 'text',
  },
  // decisions (docs/12 slice 2): agents' nmq cards with authoritative open/answered state —
  // the mobile thread reads status from here (and can answer via the shared decision.answer)
  decisions: {
    workspace_id: 'text', channel_id: 'text', task_id: 'text', message_id: 'text', asker_kind: 'text', asker_id: 'text',
    question: 'text', options: 'text', allow_other: 'integer', status: 'text', answer: 'text',
    answered_by_kind: 'text', answered_by_id: 'text', created_at: 'text', answered_at: 'text',
  },
  // policies (agent permission engine, Phase 1): human-configured allow/ask/deny rules the
  // daemon reads locally to gate agent tool calls. selector is jsonb → JSON text on the client.
  policies: {
    workspace_id: 'text', scope: 'text', project_id: 'text', channel_id: 'text', agent_id: 'text', capability: 'text',
    selector: 'text', verdict: 'text', rationale: 'text', locked: 'integer',
    created_by_kind: 'text', created_by_id: 'text', created_at: 'text', updated_at: 'text',
  },
  memory_blocks: { workspace_id: 'text', channel_id: 'text', project_id: 'text', kind: 'text', content: 'text', basis_count: 'integer', updated_at: 'text' },
  // Shared compute (0114): `owner_user_id` is WHOSE machine this is and `runtimes` is what it can
  // serve. Both are inputs to the origin-affinity policy (shared/src/compute.ts) — a host has to
  // answer them about its PEERS, so they have to be in the replica, not probed locally.
  machines: { workspace_id: 'text', owner_user_id: 'text', runtimes: 'text', name: 'text', platform: 'text', kind: 'text', daemon_version: 'text', last_seen_at: 'text' },
  // `description` (0110) is the ROUTING string — what the agent does + when to route work to it,
  // read by the orchestrator in list_agents and shown on the hover card. `brief` is the
  // INSTRUCTIONS — how it works, injected into its own turns. Two readers, two fields.
  agents: { workspace_id: 'text', machine_id: 'text', name: 'text', role: 'text', model: 'text', runtime: 'text', model_source: 'text', emoji: 'text', card: 'text', kind: 'text', endpoint_url: 'text', status: 'text', retired_at: 'text', description: 'text', brief: 'text' },
  skills: { workspace_id: 'text', channel_id: 'text', name: 'text', description: 'text', scope: 'text', body: 'text', status: 'text', author_kind: 'text', author_id: 'text', version: 'integer', pack_id: 'text', enabled: 'integer', created_at: 'text', updated_at: 'text' },
  skill_packs: { workspace_id: 'text', channel_id: 'text', name: 'text', description: 'text', source_url: 'text', source_ref: 'text', version: 'text', origin: 'text', enabled: 'integer', status: 'text', step: 'text', progress: 'integer', error: 'text', created_at: 'text', updated_at: 'text' },
  // schedules (marketing-channel plan §4.6): the generic "run X at time T" primitive —
  // the daemon minute-tick claims due rows by run_count CAS; the HQ rail + calendar read them
  schedules: {
    workspace_id: 'text', channel_id: 'text', title: 'text', cadence: 'text', at_time: 'text', tz: 'text',
    weekday: 'integer', next_run_at: 'text', run_count: 'integer', agent_id: 'text', payload: 'text',
    status: 'text', created_by_kind: 'text', created_by: 'text', last_run_at: 'text', last_error: 'text', created_at: 'text',
  },
  // content items (marketing-channel plan §4.7): the calendar's atoms — agents draft,
  // humans publish; external_url is the receipt once the server publishes via connectors
  content_items: {
    workspace_id: 'text', channel_id: 'text', schedule_id: 'text', task_id: 'text', thread_id: 'text', platform: 'text', body: 'text',
    media: 'text', status: 'text', scheduled_at: 'text', published_at: 'text', external_url: 'text',
    approved_by: 'text', approved_at: 'text', created_by_kind: 'text', created_by: 'text', last_error: 'text', created_at: 'text',
  },
  // connectors (marketing-channel plan §4.8): the VISIBLE half of a workspace's social
  // accounts — provider/handle/status only; sealed tokens never reach any client replica
  // `project_id` (0106) is what a connector's identity belongs to — one account per PROJECT,
  // not per workspace; `channel_id` only records where the OAuth round-trip was started.
  connectors: { workspace_id: 'text', channel_id: 'text', project_id: 'text', provider: 'text', handle: 'text', status: 'text', scopes: 'text', connected_by: 'text', created_at: 'text' },
  // whiteboards (0111, docs/38): Excalidraw scenes. scene/source jsonb → JSON text here; the
  // phone renders snapshot_svg in cards and never mounts a live canvas. rev/snapshot_rev drive
  // the save guard + stale-still detection exactly as on desktop.
  whiteboards: {
    workspace_id: 'text', channel_id: 'text', thread_id: 'text', task_id: 'text', title: 'text',
    scene: 'text', source: 'text', snapshot_svg: 'text', snapshot_rev: 'integer', rev: 'integer',
    archived_at: 'text', created_by_kind: 'text', created_by: 'text', updated_by_kind: 'text', updated_by: 'text',
    created_at: 'text', updated_at: 'text',
  },
  // code_sessions (0135, the mobile-cloud round): one synced row per engineering session — repo, branch,
  // mode, state, the last line — what the phone's Code tab lists; the machine's transcript stays authoritative
  code_sessions: {
    workspace_id: 'text', project_id: 'text', repo_id: 'text', repo_name: 'text', branch: 'text', title: 'text',
    mode: 'text', state: 'text', machine_id: 'text', created_by: 'text', last_line: 'text',
    changes_count: 'integer', checkpoints_count: 'integer', created_at: 'text', updated_at: 'text', ended_at: 'text',
  },
  agent_channels: { agent_id: 'text', channel_id: 'text', created_by_kind: 'text', created_by: 'text', created_at: 'text' },
  // `compute` (0118): the member's compute choice — {machine, agents} jsonb as JSON text here.
  // Every daemon reads the ORIGIN member's row in shouldClaim, so it must replicate.
  workspace_members: { workspace_id: 'text', user_id: 'text', role: 'text', display_name: 'text', compute: 'text' },
  // channel people roster (0094) — who the rail lists per room; not an ACL
  channel_members: { channel_id: 'text', user_id: 'text', created_by: 'text', created_at: 'text' },
} as const satisfies Record<string, Record<string, 'text' | 'integer'>>;

const col = (t: 'text' | 'integer') => (t === 'integer' ? column.integer : column.text);

export const AppSchema = new Schema(
  Object.fromEntries(
    Object.entries(TABLE_COLUMNS).map(([name, cols]) => {
      const columns: Record<string, ReturnType<typeof col>> = {};
      for (const [c, t] of Object.entries(cols)) columns[c] = col(t);
      return [name, new Table(columns)];
    }),
  ),
);
