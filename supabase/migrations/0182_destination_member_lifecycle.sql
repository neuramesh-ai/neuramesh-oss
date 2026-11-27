-- Leaving a workspace retires its destination grants. A later invitation must not
-- silently restore access to Finance or Marketing from the previous membership.
create function nm_remove_destination_principal() returns trigger language plpgsql as $$
declare target_workspace uuid; target_id uuid; target_kind text; removed_destination text;
begin
  target_workspace=old.workspace_id; target_id=old.id; target_kind='agent';
  if tg_table_name='workspace_members' then target_id=old.user_id; target_kind='human'; end if;
  if tg_op='UPDATE' then
    if new.retired_at is null then return new; end if;
  end if;
  for removed_destination in
    delete from workspace_destination_members where workspace_id=target_workspace and principal_kind=target_kind and principal_id=target_id returning destination
  loop
    if exists(select 1 from workspaces where id=target_workspace) then
    insert into workspace_destination_revisions(workspace_id,destination,revision) values(target_workspace,removed_destination,1)
    on conflict(workspace_id,destination) do update set revision=workspace_destination_revisions.revision+1;
    end if;
  end loop;
  perform pg_notify('nm_sync',target_workspace::text);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger nm_destination_member_left after delete on workspace_members for each row execute function nm_remove_destination_principal();
create trigger nm_destination_agent_retired after update of retired_at on agents for each row when (new.retired_at is not null) execute function nm_remove_destination_principal();
create trigger nm_destination_agent_deleted before delete on agents for each row execute function nm_remove_destination_principal();
-- Historical attribution must not prevent an account's normal deletion after an
-- ownership transfer. It is never used as an authorization source.
alter table workspace_destination_members alter column added_by drop not null;
alter table workspace_destination_members drop constraint workspace_destination_members_added_by_fkey;
alter table workspace_destination_members add constraint workspace_destination_members_added_by_fkey foreign key(added_by) references nm_users(id) on delete set null;
alter table workspace_finance_links alter column connected_by drop not null;
alter table workspace_finance_links drop constraint workspace_finance_links_connected_by_fkey;
alter table workspace_finance_links add constraint workspace_finance_links_connected_by_fkey foreign key(connected_by) references nm_users(id) on delete set null;
