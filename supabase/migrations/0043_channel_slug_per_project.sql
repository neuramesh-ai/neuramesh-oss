-- Channel slug uniqueness moves from per-WORKSPACE to per-PROJECT.
--
-- 0035 made channels.project_id the ownership link (1:N) but kept unique(workspace_id, slug)
-- "for the switcher" — which meant a workspace could hold only ONE #dev, so creating a project
-- with its own #dev was impossible and "moving channels into a project" silently emptied the
-- source. The real key for a channel is its UUID id; the slug is just a per-project display name.
--
-- After this, two projects in the same workspace can each own a #dev (distinct ids), and every
-- channel reference in the app keys on the id (see the control-api/daemon channel-id rework that
-- ships with this). Slug stays unique WITHIN a project so a project's room list is unambiguous.
alter table channels drop constraint channels_workspace_id_slug_key;
alter table channels add constraint channels_project_id_slug_key unique (project_id, slug);
