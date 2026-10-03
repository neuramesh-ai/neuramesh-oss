// Replica tables: channels, messages, threads, channel_members — part of the shared client schema (../schema.ts).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching sync rule (dev/stack/powersync/sync-config.yaml), because every client reads this file.
import { column, Table } from '@powersync/common';

// INDEXES: a replica row is JSON in ps_data__<table>, and every column is a json_extract, so a
// table with no index answers every `where x = ?` — and every correlated subquery, once PER OUTER
// ROW — with a full scan that decodes each row's JSON. The watches join messages from threads,
// tasks and decisions that way; on a 1.7k-message replica that cost 1.6 s for the session list
// alone (docs/18). PowerSync turns each entry into an expression index on the same expression the
// view uses, so the planner seeks. Each index is named for the lookup it serves; a new query
// that filters or correlates on a column should find one here, or add one.

// created_at + created_by* feed the room's papertrail (0093) — the intro block derives
// "geo created this channel" from synced rows, so it reads offline like the rest of the feed.
export const channels = new Table({ workspace_id: column.text, slug: column.text, topic: column.text, project_id: column.text, kind: column.text, marketing: column.text, created_by_kind: column.text, created_by: column.text, created_at: column.text }, {
  indexes: { by_project: ['project_id'] },
});

export const messages = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  task_id: column.text,
  thread_id: column.text,
  // LOCAL-ONLY transport (docs/31): when this send births a thread by replying to a room
  // message, the root rides here so uploadData can pass it to /v1/messages. The server keeps
  // the root on `threads`, never on a message, so sync never sends this back down.
  root_message_id: column.text,
  // LOCAL-ONLY transport (docs/34), same shape: the composer's Tasks toggle at the moment of
  // sending. The server applies it ONLY when this message BIRTHS the thread and stores it on
  // `threads.mode`, so — like the root — it never comes back down on a message row.
  // Named `birth_mode`, NOT thread_mode: `channels.thread_mode` is the unrelated docs/20 view
  // lens (threads on/off in a room), and one grep returning both would be a trap.
  birth_mode: column.text,
  // docs/10 §15: the composer's brain draft, carried on the send that BIRTHS the thread. Local
  // only, like birth_mode — the server keeps it on `threads`, so sync never writes it back.
  birth_brain: column.text,
  // 0134, rule D9: the session's designated machine and the client that bore it, carried on the
  // send that BIRTHS the thread. Local only, like the two above — the server keeps them on `threads`.
  birth_machine: column.text,
  birth_origin: column.text,
  // 0144, coding threads: the kind the send births the thread with (`coding` when the composer's
  // repo chip was set). Local only, like the four above — the server keeps it on `threads.kind`.
  birth_kind: column.text,
  author_kind: column.text,
  author_id: column.text,
  body: column.text,
  created_at: column.text,
  pinned: column.integer,
  // 0145, routine sessions: the schedule whose run this message opens. Synced, unlike the birth_*
  // transport above: every client splits a routine's one session into its runs by it.
  schedule_id: column.text,
}, {
  indexes: {
    by_thread: ['thread_id', 'created_at'],
    by_task: ['task_id', 'created_at'],
    by_channel: ['channel_id', 'created_at'],
  },
});

// conversation threads: every send starts one; threads.task_id links the task a
// conversation upgraded into (the thread IS that task's thread from then on)
export const threads = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  title: column.text,
  description: column.text,
  created_by: column.text,
  task_id: column.text,
  // docs/31: the room message this thread hangs off. The root STAYS in the feed and grows a
  // replies footer; only the replies live in the thread.
  root_message_id: column.text,
  // Archived conversations (0108): set means the human filed it away — it leaves Recents, its
  // room's session list and search, and lives only in Settings › Archived chats. Null is live.
  archived_at: column.text,
  // 0137: when a human settled the thread (thread.settle). A gate or card newer than the stamp
  // brings it back to Needs you; the stamp itself is never a flag (shared/threadstatus.ts).
  settled_at: column.text,
  // docs/34: 'tasks' (the orchestrator triages this into board work) or 'chat' (the agent
  // answers here and nothing reaches the board). Frozen at birth; moved only by a human.
  mode: column.text,
  // 0119: the automation that opened this thread — a routine run wears its own marker (2026-08-22)
  schedule_id: column.text,
  // 0134, rule D9: the session's designated machine and the client that bore it (the thread head's toks)
  machine_id: column.text,
  origin: column.text,
  // 0144: 'chat' (a conversation) or 'coding' (the coding runtime works on a repository in it —
  // the one session surface wears the code face, docs/design/coding-threads-2026-09). Born at the
  // send, or moved by thread.set_kind (a human, or the room's orchestrator from its triage turn).
  kind: column.text,
  // docs/10 §15: role → model, for THIS conversation. jsonb server-side, text here (PowerSync
  // has no json type) — `parseBrainOverride` is the one reader. Null = the project's brain.
  brain_override: column.text,
  created_at: column.text,
  updated_at: column.text,
}, {
  indexes: {
    by_channel: ['channel_id', 'updated_at'],
    by_task: ['task_id', 'created_at'],
    by_root: ['root_message_id'],
  },
});

// channel people roster (0094) — who the rail lists per room; not an ACL
export const channel_members = new Table({ channel_id: column.text, user_id: column.text, created_by: column.text, created_at: column.text });
