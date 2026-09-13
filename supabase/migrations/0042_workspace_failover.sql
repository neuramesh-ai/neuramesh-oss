-- Workspace-level provider-auth FAILOVER policy (editable in Workspace settings, next to the
-- model-provider keys). When an agent's preferred SUBSCRIPTION login (a local CLI: ~/.claude /
-- ~/.codex / ~/.gemini) is expired or unavailable, this decides what happens:
--   false (default, "Manual") — never auto-use an API key; the agent surfaces an auth card asking
--                               the human to reconnect or explicitly switch to key mode. No
--                               unintended metered spend (the BYOK doctrine: never surprise cost).
--   true  ("Auto")           — fail over to a provided API key (stored cred or env) automatically.
-- The daemon reads this in resolveToken (piggybacked on /v1/credentials/resolve). Default false so
-- existing subscription users are never silently billed.
alter table workspaces add column auto_failover boolean not null default false;
