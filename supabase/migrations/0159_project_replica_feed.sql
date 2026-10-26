-- Local desktop replicas need membership changes after their initial snapshot too.
-- Use the same transaction ordering and tombstone protocol as all existing tables.
create trigger local_sync_guard before insert or update or delete on project_agents
  for each statement execute function lock_local_sync_revision();
create trigger local_sync_change after insert or update on project_agents
  for each row execute function record_local_sync_change();
create trigger local_sync_delete before delete on project_agents
  for each row execute function record_local_sync_change();

-- Preserve the old no-op task update contract. Only a project-only metadata change
-- avoids an activity/version bump during migration or legacy ownership repair.
create or replace function nm_tasks_touch() returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id
    and (to_jsonb(new) - 'project_id') = (to_jsonb(old) - 'project_id') then return new; end if;
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end $$;
