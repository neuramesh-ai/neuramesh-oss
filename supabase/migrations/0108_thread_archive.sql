-- Archiving a conversation (round 1, George 2026-08-03).
--
-- A chat thread the human is done with should leave Recents and its room's session list entirely
-- and be reachable only from Settings › Archived chats. That is a per-thread, human-owned fact, so
-- it is a nullable timestamp rather than a boolean: WHEN it was archived is what the settings list
-- sorts by, and null is the whole of "live".
--
-- Deliberately NOT a delete: an agent's runs, artifacts, lessons and memory all reference a thread,
-- so removing the row would strand them. Archiving hides; nothing is destroyed.
alter table threads add column if not exists archived_at timestamptz;

-- The read this exists for is "live threads in this channel", which every session list runs on
-- every render. Partial, because archived rows are the rare case and never the ones being listed.
create index if not exists threads_live_by_channel
  on threads (channel_id, updated_at desc)
  where archived_at is null;
