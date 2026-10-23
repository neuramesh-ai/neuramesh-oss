-- Ownership metadata is not task activity. Backfilling an old task must preserve
-- its optimistic version and its position in history.
create or replace function nm_tasks_touch() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'project_id') = (to_jsonb(old) - 'project_id') then return new; end if;
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $$;

-- Project defaults are authoritative for new work. Old clients can still edit the
-- compatibility context. Historical contexts keep their own settings and profiles.
create function nm_context_defaults_to_project() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update projects p set
    settings = case when new.settings is distinct from old.settings then new.settings else p.settings end,
    brand_profile = case when new.marketing is distinct from old.marketing then new.marketing else p.brand_profile end
    where p.context_channel_id = new.id;
  return null;
end $$;
create trigger context_defaults_to_project after update of settings, marketing on channels
  for each row execute function nm_context_defaults_to_project();

create function nm_project_defaults_to_context() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update channels c set
    settings = case when new.settings is distinct from old.settings then new.settings else c.settings end,
    marketing = case when new.brand_profile is distinct from old.brand_profile then new.brand_profile else c.marketing end
    where c.id = new.context_channel_id and c.project_id = new.id;
  return null;
end $$;
create trigger project_defaults_to_context after update of settings, brand_profile on projects
  for each row execute function nm_project_defaults_to_context();
