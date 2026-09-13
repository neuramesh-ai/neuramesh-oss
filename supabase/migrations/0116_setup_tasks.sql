-- Setup flows (2026-08-09): a channel kind's guided first-run becomes a TASK the human can
-- abandon and come back to (kind='setup', lean finish/cancel life — shared/setupflows.ts).
--
-- The wizard used to be a card rendered from a null profile: walk away mid-setup and nothing
-- existed to resume. Now the room's creation also creates one setup task, so the queue holds
-- the ball until the flow completes or the human cancels it.
--
-- The kind value ONLY — its partial-unique index is 0117, because the runner applies each file
-- as one transaction and Postgres refuses to USE an enum value in the txn that added it
-- ("unsafe use of new value"). 0089 (content) never hit this: nothing used the value in-file.

alter type task_kind add value if not exists 'setup';
