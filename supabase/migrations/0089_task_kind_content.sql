-- The marketing content kind (marketing-workflow plan §5 — the phase-2 item the
-- Marketing HQ plan named). A chat ask in a marketing room ("draft two X posts") is a
-- CONTENT task, not `docs`: it routes to the marketer with a publish-readiness
-- Definition of Done, and its deliverables are content_items rendered inline as posts,
-- not a markdown file. Append-only + nullable exactly like 0057 — no backfill; the
-- tasks sync rule is `select *` (dev/stack/powersync/sync-config.yaml) so it replicates
-- to every client with NO PowerSync redeploy. Mirror @neuramesh/shared TASK_KINDS.
alter type task_kind add value if not exists 'content';
