-- INTAKE AND SCRATCH WORKSPACES (round 9, decisions of 2026-11-06).
--
-- A thread's first human message goes through INTAKE: a fast structured decision by the NeuraMesh
-- starter brain in nm-api (packages/shared/src/intake.ts, IntakeDecision). It names the ask, sets the
-- title, says what kind of work it is, lists the plan and the subtasks, and says which workspace the
-- work needs. A coding ask becomes a coding thread at once: with a repository it gets a worktree of
-- that repository, and with no repository it gets a local scratch workspace (a fresh git repository on
-- the machine). The person's selected agent then runs the work with the decision in its context.
--
--   threads.intake          the stored IntakeDecision (jsonb). Null: no intake ran (an older thread,
--                           an intake that failed, or a thread born by a client that skipped it).
--   threads.workspace_mode  for a coding thread: 'repo' (a worktree of a project repository) or
--                           'scratch' (a local scratch workspace with no remote). Null: decided by
--                           the old rule (a coding thread works on the project's primary repository).
--
-- threads is already on the per-workspace feed (0159, 0173), so both columns reach every replica
-- (packages/client-core/src/tables/rooms.ts lists them). Additive only. ADD COLUMN without a default
-- is a catalog change, so the ACCESS EXCLUSIVE lock is held for milliseconds.
set local lock_timeout = '5s';

alter table threads add column if not exists intake jsonb;
alter table threads add column if not exists workspace_mode text
  check (workspace_mode in ('repo', 'scratch'));
