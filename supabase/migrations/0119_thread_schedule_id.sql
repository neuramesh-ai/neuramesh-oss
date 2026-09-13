-- 0119 — a run thread knows which automation spawned it (2026-08-11, George).
--
-- An armed automation fires its prompt into the room and BIRTHS A THREAD (agents.ts, the minute
-- tick) — so its run history already exists as conversations, scattered among every other thread
-- in the room with nothing tying them to the row that started them. The Automations card can now
-- reveal "recent runs", which needs that link to be a column, not a guess.
--
-- Birth-only, like `mode` and `brain_override`: written on the INSERT that creates the thread and
-- never in the conflict branch, so a later message into the same conversation cannot re-attribute
-- it. `on delete set null` — removing an automation must not take its history with it; those
-- conversations happened, and the threads keep standing on their own.
--
-- threads syncs as `select *` (dev/stack/powersync/sync-config.yaml), so this column reaches the
-- replicas with no sync-rule deploy. It DOES need a PowerSync re-snapshot to backfill existing
-- rows on already-connected clients — see the PR's Deploy notes.
alter table threads add column if not exists schedule_id uuid references schedules (id) on delete set null;
create index if not exists threads_schedule_idx on threads (schedule_id, created_at desc) where schedule_id is not null;

-- One-time backfill for runs that already happened. Until this migration the ONLY trace of a
-- routine fire was the marker the daemon writes as the thread's opening line:
--   ⏱ **Routine — <title>**\n\n<prompt>
-- so that marker is read exactly ONCE, here, where its brittleness can be reasoned about (a
-- renamed automation simply doesn't match, and its old runs stay unattributed) instead of at every
-- render. `left(...) =` rather than `like`, because a title containing % or _ would otherwise
-- match the wrong rows. Two same-titled automations in one room is genuinely ambiguous; the update
-- picks one, which is still better history than none.
update threads t
   set schedule_id = s.id
  from schedules s, messages m
 where t.schedule_id is null
   and t.root_message_id = m.id
   and m.channel_id = s.channel_id
   and left(m.body, length('⏱ **Routine — ' || s.title || '**')) = '⏱ **Routine — ' || s.title || '**';
