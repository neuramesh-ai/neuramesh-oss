-- PR-based git flow (docs/decisions 2026-06-17): a repo-backed task's developer
-- pushes its branch then opens a pull request with the machine's own `gh` creds.
-- The task carries the PR pointer (url + number) so the reviewer can gate on its
-- CI (`gh pr checks`) and the merge-on-accept watch can squash-merge it once a
-- human accepts. Cloud holds only the pointer — never code, never a repo token.
-- Additive — rides the existing `select *` tasks sync rule + the publication.
alter table tasks add column pr_url text not null default '';
alter table tasks add column pr_number int;
