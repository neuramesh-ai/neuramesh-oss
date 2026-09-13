-- A drafted post belongs to a CONVERSATION, not only to a task.
--
-- Until now `content_items` could hang off exactly one thing — `task_id` (0084) — and the only
-- surface that drew a post card read it back through a task (`contentByTask`, gated on
-- `tasks.kind = 'content'`). That made the card structurally unreachable from a thread, which is
-- why an orchestrator asked for drafts in a room had no move except to propose a content task:
-- there was no other way to render one. Declining the card left it with nothing at all, and the
-- fallback — writing the marketer's `posts.json` wire file into the thread — cards as read-only
-- text with no approve, no schedule and no request-changes. Useless to the human.
--
-- `thread_id` is the fix, and it is the same shape whiteboards already use (0111): a row that
-- belongs to a conversation. A draft carries EITHER a thread or a task (a task thread's drafts
-- keep riding `task_id`, byte-identical), never both as a requirement — both stay nullable so
-- every existing row is already valid and no backfill is needed.
--
-- Publishing is unaffected: `connectorWithSecret` resolves an item's account through its CHANNEL's
-- project (0106), and `channel_id` is still required. A thread-drafted post publishes through the
-- same account a task-drafted one would.
alter table content_items add column if not exists thread_id uuid references threads(id) on delete cascade;
create index if not exists content_thread_idx on content_items(thread_id, created_at asc);

-- Deploy notes: none beyond the migration. The PowerSync stream for this table is
-- `select * from content_items` (dev/stack/powersync/sync-config.yaml), so the new column rides
-- down without a sync-rules deploy or a re-snapshot.
