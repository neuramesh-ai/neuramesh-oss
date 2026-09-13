-- Per-channel threads mode (docs/03 §5, mockups/threads-mode.html). A room-wide view
-- preference: 'on' (default) keeps today's behavior — task replies live in their threads,
-- the channel reads as orchestrator digests; 'off' widens the channel feed to show thread
-- traffic inline, each agent reply tagged with its task. It is a LENS, never a reroute —
-- every message still lives in its thread (task_id unchanged), so the cockpit, review gates,
-- beats, and stall watchdog are untouched. Synced to clients via the channels sync rule
-- (`select *`), so no PowerSync rule redeploy — just the client-core / desktop schema mirror.
alter table channels add column thread_mode text not null default 'on'
  check (thread_mode in ('on', 'off'));
