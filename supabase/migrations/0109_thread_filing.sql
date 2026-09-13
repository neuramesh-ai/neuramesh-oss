-- 0109 — auto-filing (docs/35 §1): the orchestrator puts a conversation in the right room, once,
-- and the thread records that it did.
--
-- `filed_at` is the ONE-MOVE gate for an agent (a second agent move is two triage turns
-- disagreeing, and rex wakes on every message); `filed_reason` is the one clause it gives, shown
-- in the thread beside Undo. A human is not bound by either — they may move a chat thread as
-- often as they like, and their move deliberately leaves `filed_at` untouched.
--
-- Additive + nullable on a table the sync rules already select * from (dev/stack/powersync/
-- sync-config.yaml), so the replica picks both columns up with NO sync-rule redeploy and no
-- re-snapshot. Nothing to backfill: a null `filed_at` is exactly "never filed", which is what
-- every existing thread is.
alter table threads add column if not exists filed_at timestamptz;
alter table threads add column if not exists filed_reason text;
