-- Default destination grants (George, 2026-11-17). The orchestrator works in Marketing and
-- Finance, and the Finance agent works in Finance, from the moment each is born or rehired.
-- The owner can still remove a grant: an ordinary re-register (every boot) does not add it back.
-- added_by is null: the platform made the grant, not a person.
create function nm_default_destination_grants() returns trigger language plpgsql as $$
declare granted_destination text;
begin
  if tg_op='UPDATE' and not (old.retired_at is not null and new.retired_at is null) then return new; end if;
  if new.retired_at is not null then return new; end if;
  for granted_destination in
    insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by)
    select new.workspace_id,d,'agent',new.id,null
      from unnest(case new.role::text when 'orchestrator' then array['marketing','finance'] when 'finance' then array['finance'] else array[]::text[] end) d
    on conflict do nothing returning destination
  loop
    insert into workspace_destination_revisions(workspace_id,destination,revision) values(new.workspace_id,granted_destination,1)
    on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
  end loop;
  perform pg_notify('nm_sync',new.workspace_id::text);
  return new;
end $$;
create trigger nm_destination_agent_born after insert on agents for each row execute function nm_default_destination_grants();
create trigger nm_destination_agent_rehired after update of retired_at on agents for each row when (old.retired_at is not null and new.retired_at is null) execute function nm_default_destination_grants();

-- The orchestrators that exist now get the same grants once.
with granted as (
  insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by)
  select a.workspace_id,d,'agent',a.id,null from agents a cross join unnest(array['marketing','finance']) d
   where a.role::text='orchestrator' and a.retired_at is null
  on conflict do nothing returning workspace_id,destination
)
insert into workspace_destination_revisions(workspace_id,destination,revision)
select workspace_id,destination,1 from granted group by workspace_id,destination
on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
