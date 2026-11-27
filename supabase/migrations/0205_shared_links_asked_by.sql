-- An agent publishes on the person's request (docs/design/inbox-sales-2026-11/plan.md I14 point 4, George,
-- 2026-11-24). The API lets an agent publish only when a person typed in the session in the last 30 minutes, and
-- this column holds that person: the human whose message allowed the publish. made_by is then the agent.
-- Null for a person's own Publish. The pages role never reads it (published_links_grant names its columns).
--
-- The file name has no "publish": the test database scripts skip a file with that word.
alter table published_links add column if not exists asked_by uuid;
