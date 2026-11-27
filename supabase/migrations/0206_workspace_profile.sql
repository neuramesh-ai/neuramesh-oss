-- THE COMPANY PROFILE (docs/design/onboarding-2026-11/plan.md O2). The first run's card 1 answers: what the
-- company sells, who works on it, what the person wants help with first, and the website. Written only by the
-- control-api (`workspace.set_profile`, human only), read back in `GET /v1/workspaces`.
--
-- One jsonb column, not a table: it is one small object per workspace, the shape lives in one zod schema
-- (packages/shared/src/company-profile.ts), and the first run only ever writes it whole. Null means the first
-- run has not answered card 1, which is also how the boot backfill tells a new workspace from an old one: the
-- marketing setup task is planted only in a workspace that has agents and no profile (pgstore.backfillSetupTasks).
alter table workspaces add column if not exists profile jsonb;
