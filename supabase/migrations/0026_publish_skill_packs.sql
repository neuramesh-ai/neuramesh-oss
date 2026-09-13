-- Publish skill_packs for PowerSync (channel-scoped sync; the dev/test harness's
-- 99-publication.sql includes it directly, this is the prod alter). The new
-- skills.pack_id / skills.enabled columns ride the existing skills publication.
alter publication powersync add table public.skill_packs;
