// Synced-row shapes (rows-board) — extracted from App.tsx (modularization track A1).
// Pure types: what the renderer receives over the NMBridge watches/reads.

export interface TaskRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  kind: string | null;
  assignee_kind: string | null;
  assignee_id: string | null;
  offered_agent_id: string | null;
  requirements: string | null;
  requirements_confirmed: number | null;
  definition_of_done: string | null;
  project_id: string | null;
  channel_id: string;
  branch: string | null;
  repo_id: string | null;
  submitted_sha: string | null;
  pr_url: string | null;
  pr_number: number | null;
  artifact_count: number | null;
  ship_plan: string | null;
  parent_task_id: string | null;
  /** plan-first units (2026-08-17): the declared journey + proposed subtasks + approach (JSON text) */
  work_plan?: string | null;
  /** the conversation that OWNS this unit (thread-owned work) */
  origin_thread_id?: string | null;
  plan_approved_at?: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  accepted_at: string | null;
  closed_at: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  is_default: number;
}

// the top-left switcher's view: a workspace project + the channels it spans + counts
export interface WorkspaceProjectRow {
  id: string;
  name: string;
  slug: string;
  is_default: number;
  status: string;
  description: string;
  channel_slugs: string | null; // comma-joined channel slugs (group_concat)
  primary_channel: string | null; // the project's home channel (chat focus)
  open_tasks: number;
  auto_open_pr?: number | null; // automation policy (PowerSync booleans → 0/1)
  run_ci_before_merge?: number | null;
  ship_gate?: number | null; // the release gate (docs/23) — null reads ON
  website?: string | null; // project identity — the site it ships…
  logo_url?: string | null; // …and its detected logo (compact data: URL)
  model_pack?: string | null; // per-project brain override (docs/10) — null = inherit the workspace pack
  // Projects-page card aggregates (projmeta.ts): the four pulse buckets sum to open_tasks
  t_pre?: number | null;
  t_build?: number | null;
  t_review?: number | null;
  t_land?: number | null;
  agents_count?: number | null; // registered via this project's rooms, retired excluded
  last_activity?: string | null; // max(tasks.updated_at) — the card's "active Xh ago"
}

export interface RepoUI {
  id: string;
  provider?: string;
  org_name: string;
  name: string;
  default_branch: string;
  local_path?: string | null;
  /** Comma-separated project ids from project_repos; used by project-aware Code drafts. */
  project_ids?: string | null;
  /** Projects for which this is the primary repo. */
  primary_project_ids?: string | null;
}

export interface TaskAllRow extends TaskRow {
  channel_slug: string;
  /** newest human message in this task's thread — feeds awaitingAgent (needsyou.ts) */
  last_human_msg_at?: string | null;
  /** the task's thread and its settle stamp (0137) — what the bell's Settle acts on and reads */
  thread_id?: string | null;
  settled_at?: string | null;
}

// Decisions (docs/12 slice 2): an agent's nmq question card as a synced row with
// authoritative open/answered state (nm:watch-decisions-all). options is JSON text.
export interface DecisionAllRow {
  id: string;
  channel_id: string;
  task_id: string | null;
  message_id: string;
  asker_kind: string;
  asker_id: string;
  question: string;
  options: string | null;
  allow_other: number;
  status: string; // open | answered | dismissed
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  channel_slug: string;
  task_number: number | null;
  /** the thread the asking message lives in — the row's door when task_id is null */
  thread_id?: string | null;
  /** newest human message in this card's own conversation — feeds decisionHandled (needsyou.ts) */
  human_replied_at?: string | null;
  /** the settle stamps this card can sit under (0137): its conversation's, and its task's thread's */
  thread_settled_at?: string | null;
  task_thread_id?: string | null;
  task_settled_at?: string | null;
}

// Beats (docs/17): a per-phase progress step synced for the thread tracker.
export interface BeatUI {
  id: string;
  run_id: string;
  phase: string;
  role: string;
  seq: number;
  title: string;
  status: string; // pending | active | done | blocked
  started_at: string | null;
  done_at: string | null;
  created_at: string;
}

// Runs (docs/29): the synced row behind a stretch of agent work. A leg carries parent_run_id;
// everything else about the fan-out is derived from that one column.
export interface RunUI {
  id: string;
  channel_id: string;
  thread_id: string | null;
  task_id: string | null;
  agent_id: string;
  parent_run_id: string | null;
  kind: string; // wake | work | leg
  title: string;
  state: string; // running | done | failed | stopped
  step: string | null;
  /** `role·model[·@specialist]` — which config a leg runs on (0103). Null on non-leg runs. */
  seat: string | null;
  done: number;
  total: number;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  /** which member's machine served this run (0114). Shared compute means an agent is a
   *  workspace-level resource running on someone's own laptop under their own subscription —
   *  "who" is only half the answer without "where". */
  machine_id?: string | null;
  machine_name?: string | null;
}

export interface ArtifactUI {
  id: string;
  kind: string;
  name: string;
  inline_content: string | null;
  promoted?: number | null;
  created_at: string;
  task_number?: number | null;
  channel_slug?: string | null; // the room it belongs to — DISPLAY only
  channel_id?: string | null;   // …and the id, which is what scoping reads (slugs collide across projects)
  // Workspace Files reads these: `mime`/`size_bytes` type and weigh a row, `task_id` separates a
  // room's own documents from a task's deliverables, `project_id` is the folder it files under.
  mime?: string | null;
  size_bytes?: number | null;
  task_id?: string | null;
  project_id?: string | null;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  kind: string;
  name: string;
  mime: string | null;
  inline_content: string | null; // thumbnail data URI (cross-machine / loading fallback)
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  channel_slug?: string | null; // set by the workspace-wide watch (artifact screen) — DISPLAY only
  channel_id?: string | null;   // …and the id, which is what scoping reads
}
