-- Specialty brief for hired/registered agents: one line of remit ("SEO/competitive
-- analysis — report-style deliverables") stored on the agent and injected into its
-- task prompts, so a specialist stays a specialist on every future task — not just
-- a persona name. Nullable + additive: existing agents read null (prompts unchanged),
-- and the agents sync rule is `select *` with nothing to backfill (no PowerSync work).
-- 0055 is claimed by the backlog stage (PR #79); numbered around it per docs/15's rule.
alter table agents add column brief text;
