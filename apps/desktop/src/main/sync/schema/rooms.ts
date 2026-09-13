// Replica tables: channels, messages, threads, channel_members — extracted from sync.ts (track B-sync).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching client-core mirror and a sync rule — the parity test is the tripwire.
import { column, Table } from '@powersync/common';

// created_at + created_by* feed the room's papertrail (0093) — the intro block derives
// "geo created this channel" from synced rows, so it reads offline like the rest of the feed.
export const channels = new Table({ workspace_id: column.text, slug: column.text, topic: column.text, project_id: column.text, kind: column.text, marketing: column.text, created_by_kind: column.text, created_by: column.text, created_at: column.text });

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
  author_kind: column.text,
  author_id: column.text,
  body: column.text,
  created_at: column.text,
  pinned: column.integer,
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
  // docs/10 §15: role → model, for THIS conversation. jsonb server-side, text here (PowerSync
  // has no json type) — `parseBrainOverride` is the one reader. Null = the project's brain.
  brain_override: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// channel people roster (0094) — who the rail lists per room; not an ACL
export const channel_members = new Table({ channel_id: column.text, user_id: column.text, created_by: column.text, created_at: column.text });
