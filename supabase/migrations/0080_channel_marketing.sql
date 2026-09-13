-- The marketing HQ profile (docs/design/marketing-channel-2026-07 §4.3). Written only by the
-- marketing.setup command (human-only, free on every plan — the paywall sits on schedule.*/
-- content.*, not here): { website, focus[], setup_by, setup_at }. Command-mutated jsonb on the
-- channel row, the tasks.ship_plan idiom — synced via the channels `select *` rule, so no
-- PowerSync redeploy; clients read it to decide setup-card vs working-HQ rendering.
alter table channels add column marketing jsonb;
