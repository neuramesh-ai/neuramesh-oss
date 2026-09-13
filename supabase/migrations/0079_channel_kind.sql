-- Channel kinds (docs/design/marketing-channel-2026-07/plan.md §4.1). A channel's kind picks
-- the room's interface + toolbelt: 'build' is today's product bit-for-bit (chat + board);
-- 'marketing' turns the room into the growth HQ (Feed · Calendar · Library, the marketing
-- crew, schedules, content). A kind is a LENS plus a toolbelt, never a silo — same channels
-- row, same agent_channels ACL, same task FSM, same artifacts. Existing rooms default 'build'
-- and are never converted by the server: slug-'marketing' build rooms get a one-time human
-- prompt in the app (channel.set_kind, human-only). Synced via the channels sync rule
-- (`select *`), so no PowerSync rule redeploy — just the client-core / desktop schema mirror.
alter table channels add column kind text not null default 'build'
  check (kind in ('build', 'marketing'));
