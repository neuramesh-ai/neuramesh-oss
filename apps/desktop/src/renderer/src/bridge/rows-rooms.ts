// Synced-row shapes (rows-rooms) — extracted from App.tsx (modularization track A1).
// Pure types: what the renderer receives over the NMBridge watches/reads.

export interface ChannelRow {
  /** every message the room has carried, task threads included — the busiest-first order (2026-08-11) */
  msg_count?: number;
  id: string;
  slug: string;
  topic: string;
  project_id: string | null; // which project owns this room — channel slugs collide across projects
  // `channels.thread_mode` is deliberately absent: the docs/20 lens retired with the feed
  // (docs/35 §4.1) and NOTHING reads the column now, so a room still holding 'off' behaves
  // exactly like every other room. The column stays in the schema, inert.
  kind?: string; // 'build' (default) | 'marketing' — what the room is for; picks the interface + toolbelt (marketing-channel plan §4.1)
  marketing?: string; // JSON marketing profile ({ website, focus[], setup_by, setup_at }) — null until marketing.setup runs
  // room papertrail (0093) — who opened the room and when. Null for rooms predating the migration,
  // which render the trail line without a name rather than hiding it.
  created_by_kind?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

// a human in this room (0094). A roster row, not a permission — see the migration.
export interface ChannelPersonRow {
  user_id: string;
  display_name: string | null;
  role: string;
  created_at: string | null;
  created_by: string | null;
}

// one membership row of a room's papertrail (0093) — an agent joining, with who brought them in
export interface ChannelHistoryRow {
  agent_id: string;
  name: string;
  role: string;
  created_at: string | null;
  created_by_kind: string | null;
  created_by: string | null;
}

// the Library surface (marketing-channel plan §4.9): a room's artifacts, foldered by kind
export interface ChannelArtifactRow {
  id: string;
  kind: string; // doc | file | screenshot | design | diff | test_report | ship
  name: string;
  mime: string | null;
  inline_content: string | null;
  size_bytes: number | null;
  promoted: number | null;
  message_id: string | null;
  task_id: string | null;
  /** pg text[] as JSON text (e.g. `["brand"]`) — the Brand-docs rail filters on it */
  tags?: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  author_kind: string;
  author_id: string;
  body: string;
  created_at: string;
  pinned?: number; // PowerSync int (0/1)
  task_id?: string | null; // the task thread this message belongs to (task-thread rows only)
  // docs/35: the room watch carries both, and together they say whether a message is LOOSE —
  // addressed to the room rather than to a conversation. `thread_id` is the message's own
  // conversation; `root_thread_id` is a conversation ROOTED at it (a reply-rooted thread leaves
  // its root's thread_id null, so neither column can answer this alone).
  thread_id?: string | null;
  root_thread_id?: string | null;
}

// a conversation thread (the conversation-first shell): every send starts one; task_id
// set = the conversation upgraded into that task's thread (the sheet swaps in place)
export interface ThreadRow {
  id: string;
  title: string;
  description: string;
  created_by: string;
  task_id: string | null;
  // docs/34 — the Tasks toggle. 'chat' = the agents answer here and nothing reaches the board;
  // absent (a pre-0099 row) reads as 'tasks' everywhere via threadModeOf.
  mode?: string | null;
  // docs/10 §15 — role → model for THIS conversation, as the jsonb text PowerSync carries.
  // parseBrainOverride is the one reader; absent/unparseable reads as "no override".
  brain_override?: string | null;
  /** 0119: the automation that opened this thread (the header's routine chip) */
  schedule_id?: string | null;
  created_at: string;
  updated_at: string;
  msg_count?: number;
  last_body?: string | null;
  // docs/31 — the room message this thread hangs off (null for Home-composer threads)
  root_message_id?: string | null;
  root_body?: string | null;
  root_author_kind?: string | null;
  root_author_id?: string | null;
  root_at?: string | null;
}

// a chat conversation as Home's in-flight list sees it: workspace-wide, task-less
// (an upgraded thread is represented by its task row instead)
// every thread in the workspace, task threads included — the nav history rail + its overlay
export interface HomeConvoRow {
  id: string;
  channel_id: string;
  channel_slug: string;
  title: string;
  task_id: string | null;
  updated_at: string;
  msg_count?: number;
  last_author_kind?: string | null; // 'agent' last = the ball is in the human's court
}


export interface HistoryThreadRow {
  id: string;
  channel_id: string;
  channel_slug: string;
  title: string;
  task_id: string | null;
  updated_at: string;
  last_body?: string | null;
  /** 0119: set = a scheduled automation opened this thread — the rows wear the routine marker */
  schedule_id?: string | null;
  /** the status inputs (shared/threadstatus.ts, 0137): the settle stamp, who spoke last and when */
  settled_at?: string | null;
  last_author_kind?: string | null;
  last_at?: string | null;
}
