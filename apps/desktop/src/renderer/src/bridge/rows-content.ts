// Synced-row shapes (rows-content) — extracted from App.tsx (modularization track A1).
// Pure types: what the renderer receives over the NMBridge watches/reads.
import type { SessionRunDraft, SessionRunMessage } from '@neuramesh/shared';

// connectors (marketing-channel plan §4.8): the visible half — never tokens
export interface ConnectorRow {
  id: string;
  provider: string; // 'x'
  handle: string;
  /** pending | connected | revoked (human disconnect) | reauth_required (the server's dead-grant
   *  verdict, 0121) — the attention bar alerts ONLY on reauth_required, never on a deliberate off */
  status: string;
}

// content items (marketing-channel plan §4.7): the calendar's atoms
export interface ContentItemRow {
  id: string;
  platform: string; // x | instagram | linkedin | tiktok | email
  media: string | null; // jsonb string — { image_url } when the draft carries media, { brief } when it only describes one
  body: string;
  status: string; // draft | scheduled | published | failed
  /** WHY it failed. `content_items.last_error` has existed since 0084 and syncs already (the rule
   *  is `select *`), but no client ever read it — so a failed post said "failed" and nothing else,
   *  with no way to find out why (George, 2026-08-18). And adding it HERE was not enough: the
   *  nm:content-* IPC selects enumerate their columns, so the field stayed absent at runtime until
   *  they shipped it too (2026-08-19) — a new column lands in this type AND in sync/ipc/content.ts. */
  last_error?: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  external_url: string | null;
  created_at: string;
  schedule_id: string | null;
  task_id: string | null; // the content task this draft delivers (marketing-workflow §4.5) — null for schedule-driven drafts
  /** the session the draft was handed over in (0115): a scheduled draft run's session since #662 */
  thread_id?: string | null;
}

// …the same atom seen from the WORKSPACE calendar, where the room is no longer implied by the
// surface you are standing on and has to ride the row (see nm:content-all).
export interface ContentItemWide extends ContentItemRow {
  channel_id: string;
  channel_slug: string | null;
  project_id: string | null;
}

// schedules (marketing-channel plan §4.6): a channel's armed drafting cadences
/** One RUN of an armed automation (routine sessions, docs/design/routine-sessions-2026-09): the
 * message that opens it. A run keeps its schedule on that message (messages.schedule_id, 0145), and
 * a session from before 0145 opens with its first message. The runs of one schedule live in its
 * session, so a run is a place in a thread: the Automations panel lists them and opens each one. */
export interface ScheduleRunRow {
  /** the opener message: the run's own id, and the `?run=` of its link */
  id: string;
  thread_id: string;
  channel_id: string;
  channel_slug: string | null;
  /** the session's title */
  title: string | null;
  created_at: string;
  /** the session's settle stamp (0137) */
  settled_at: string | null;
}

/** the listed runs, and the rows their strips count (shared session-runs.ts), for the sessions they live in */
export interface ScheduleRunsResult {
  runs: ScheduleRunRow[];
  messages: Array<SessionRunMessage & { thread_id: string }>;
  units: Array<{ id: string; number: number; title: string; state: string; kind: string | null; parent_task_id: string | null; plan_approved_at: string | null; pr_number: number | null; created_at: string; updated_at: string; last_human_msg_at: string | null; origin_thread_id: string }>;
  cards: Array<{ message_id: string; status: string; created_at: string; allow_other: number; human_replied_at: string | null; thread_id: string }>;
  drafts: Array<SessionRunDraft & { thread_id: string }>;
  files: Array<{ created_at: string; name: string; thread_id: string }>;
  openRuns: Array<{ started_at: string; thread_id: string }>;
}

export interface ScheduleRow {
  id: string;
  title: string;
  cadence: string; // once | daily | weekdays | weekly
  at_time: string;
  tz: string;
  weekday?: number | null;
  next_run_at: string | null;
  status: string; // active | paused
  run_count?: number; // how many times it has actually fired — the card's ledger line
  prompt?: string; // the drafting instruction, surfaced from the jsonb payload for the editor
  // the room it fires INTO — a routine can never be roomless (its room is the agent pool that
  // answers it), so the Automations destination tags every row with it at All scope
  channel_id?: string;
  channel_slug?: string | null;
  /** the jsonb payload as text — every schedules read selects it; a release routine keeps its
   *  cursor and its ledger lines in `payload.release` (releasescan.ts), which the Routines view reads */
  payload?: string | null;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  scope: string;
  body: string;
  status: string;
  author_kind: string;
  author_id: string;
  version: number;
  channel_id: string | null;
  channel_slug: string | null;
  pack_id: string | null;
  enabled: number; // replica boolean → 0/1
  updated_at: string;
}

export interface SkillPackRow {
  id: string;
  name: string;
  description: string;
  source_url: string;
  source_ref: string;
  version: string;
  origin: string; // 'bundled' | 'imported'
  enabled: number; // 0/1
  status: string; // 'importing' | 'ready' | 'error'
  step: string;
  progress: number;
  error: string;
  updated_at: string;
}
