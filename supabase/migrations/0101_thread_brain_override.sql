-- The thread brain override (docs/10 §15, mockups/brain-config.html).
--
-- Which MODEL each role runs, for one conversation. Resolution becomes
-- `pin > thread > project > workspace` at the one place models already resolve per wake
-- (`seatModel`, packages/shared) — so this column is the whole storage side of the feature.
--
-- Why a per-role jsonb map and not a pack id: a pack is a complete opinion about every seat,
-- and the ask is narrower — "run the developer on opus in THIS conversation" while everything
-- else keeps the project's brain. Storing a pack would force the human to re-decide seats they
-- never wanted to touch, and would make "2 changed here" unanswerable.
--
-- It belongs to the THREAD, not the task and not the channel: a task can move rooms and the
-- override must ride the conversation it was set on (ruling 5). Null = no override, which is
-- also what a Reset writes — Reset is the WHOLE override (ruling 7), so there are no partial
-- states to reason about and `{}` is never stored.
alter table threads add column if not exists brain_override jsonb;

-- Enforced, not prompted (doctrine §4): the column holds an OBJECT or nothing. An array or a
-- scalar would parse to null in the client anyway, and a column that can hold a shape nothing
-- reads is a column that will eventually hold one. The role and model VALUES are checked in the
-- command handler against the same allow-list the packs use — Postgres has no view of the model
-- catalog, and duplicating it here is exactly the drift this constraint exists to avoid.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'threads_brain_override_check') then
    alter table threads add constraint threads_brain_override_check
      check (brain_override is null or jsonb_typeof(brain_override) = 'object');
  end if;
end $$;

-- `threads` syncs as `select *` (dev/stack/powersync/sync-config.yaml), so this column rides the
-- existing sync rule — the 0098/0099 precedent, and the reason this migration needs no PowerSync
-- deploy. What it DOES need is the client-side schema mirror in packages/client-core/src/schema.ts
-- and apps/desktop/src/main/sync.ts: PowerSync drops any column the local schema does not declare,
-- so an unmirrored column syncs to nothing and the feature would silently never apply.
--
-- No backfill: every thread that already exists was born without an override, which is exactly
-- what a null column says. This comment exists so the absence of a backfill reads as a decision.
