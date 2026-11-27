-- Cover related facts, activity beats and code-session records at direct HTTP doors.
create or replace function nm_marketing_scope_for_id(target uuid) returns uuid language plpgsql stable as $$
declare rec record; table_name text;
begin
  foreach table_name in array array['channels','threads','tasks','messages','artifacts','schedules','content_items','connectors','whiteboards','runs','decisions','facts','beats','code_sessions','memory_blocks','reply_reminders'] loop
    execute format('select workspace_id,to_jsonb(t) as row from %I t where id=$1',table_name) into rec using target;
    if rec.workspace_id is not null and nm_marketing_row(rec.workspace_id,table_name,rec.row) then return rec.workspace_id; end if;
  end loop;
  return null;
end $$;
