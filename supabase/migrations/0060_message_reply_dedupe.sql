-- One wake-reply per (agent, triggering message) — enforced by the DATABASE, not the
-- daemon. A human message that wakes an agent can be observed by MORE THAN ONE live
-- daemon (a second app instance, a second host started in-session, a replayed watch):
-- every in-process dedupe is per-daemon by construction, so the #1010 double-reply
-- ("I'm the assigned worker…" posted twice) is only killable server-side. Agent wake
-- replies now carry the id of the message they answer; the partial unique index makes
-- the second insert impossible — the losing daemon gets CONFLICT and stands down.
-- reply_to is NOT synced (the messages sync rule lists columns explicitly) → no
-- PowerSync deploy; dedupe is a server-side concern only.
alter table messages add column reply_to uuid references messages (id) on delete set null;
create unique index messages_one_reply_per_trigger on messages (author_id, reply_to) where reply_to is not null;
