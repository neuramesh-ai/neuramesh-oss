-- The auto-created default project was named 'general' (0001/0035), colliding with
-- the #general channel and making "is general a project or a channel?" ambiguous.
-- Rename every workspace's default project to a neutral 'Default'. The guard skips
-- a workspace where some other project already holds the 'default' slug (rare),
-- to respect the unique(workspace_id, slug) constraint.
update projects p set name = 'Default', slug = 'default'
  where p.is_default = true
    and not exists (
      select 1 from projects o
      where o.workspace_id = p.workspace_id and o.slug = 'default' and o.id <> p.id
    );
