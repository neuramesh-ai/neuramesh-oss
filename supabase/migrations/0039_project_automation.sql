-- Per-project automation policy (editable in Project settings). Agents resolve a task's project
-- (task → channel → project) and honor these flags in the git flow:
--   auto_open_pr           — open a PR (`gh pr create`) when a task passes review (off = no PR)
--   run_ci_before_merge    — reviewer gates on `gh pr checks` / merge waits for green CI (off = skip)
-- Both default true (today's behavior). Synced to clients via `select * from projects`.
alter table projects add column auto_open_pr boolean not null default true;
alter table projects add column run_ci_before_merge boolean not null default true;
