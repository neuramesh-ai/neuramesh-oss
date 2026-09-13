-- Prod-only publication step (the 0087_publish_connectors / 0075_publish_threads convention).
-- project_repos ONLY — it gained an `id` primary key in 0106 and is now syncable, which is what
-- lets the desktop answer "does this repo belong to the project I am standing in?" without
-- guessing. Kept in its own migration so the publication change is separable from the DDL and
-- lands immediately before the sync-rules redeploy that adds the stream.
alter publication powersync add table public.project_repos;
