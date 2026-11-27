-- SALES IS A RESTRICTED DESTINATION (docs/design/inbox-sales-2026-11/plan.md S1, S2, DS2). The pipeline holds the
-- company's customers and what each deal is worth, so it reads like Finance and Marketing: the owner, the people
-- the owner adds, and the agents with the grant. The sales agent (role `sales`, pike) gets the grant when it is
-- born or rehired, the 0189 way, and the owner can still remove it.
alter table workspace_destination_members drop constraint if exists workspace_destination_members_destination_check;
alter table workspace_destination_members add constraint workspace_destination_members_destination_check
  check (destination in ('finance', 'marketing', 'sales'));
alter table workspace_destination_revisions drop constraint if exists workspace_destination_revisions_destination_check;
alter table workspace_destination_revisions add constraint workspace_destination_revisions_destination_check
  check (destination in ('finance', 'marketing', 'sales'));

-- 0189's function with one more role: the sales agent works in Sales
create or replace function nm_default_destination_grants() returns trigger language plpgsql as $$
declare granted_destination text;
begin
  if tg_op='UPDATE' and not (old.retired_at is not null and new.retired_at is null) then return new; end if;
  if new.retired_at is not null then return new; end if;
  for granted_destination in
    insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by)
    select new.workspace_id,d,'agent',new.id,null
      from unnest(case new.role::text when 'orchestrator' then array['marketing','finance'] when 'finance' then array['finance']
        when 'sales' then array['sales'] else array[]::text[] end) d
    on conflict do nothing returning destination
  loop
    insert into workspace_destination_revisions(workspace_id,destination,revision) values(new.workspace_id,granted_destination,1)
    on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
  end loop;
  perform pg_notify('nm_sync',new.workspace_id::text);
  return new;
end $$;

-- The sales agents that exist now (a hired Piper) get the same grant once.
with granted as (
  insert into workspace_destination_members(workspace_id,destination,principal_kind,principal_id,added_by)
  select a.workspace_id,'sales','agent',a.id,null from agents a where a.role::text='sales' and a.retired_at is null
  on conflict do nothing returning workspace_id,destination
)
insert into workspace_destination_revisions(workspace_id,destination,revision)
select workspace_id,destination,1 from granted group by workspace_id,destination
on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
