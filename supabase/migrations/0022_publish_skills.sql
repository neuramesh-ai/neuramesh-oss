-- Publish skills for PowerSync (channel-scoped sync; the dev/test harness's
-- 99-publication.sql includes it directly, this is the prod alter).
alter publication powersync add table public.skills;
