-- The private API connection authorizes each requester in the application and uses
-- nm_runtime's existing backend policy. Restrictive PUBLIC policies must not hide
-- Marketing rows from that connection when it has no end-user auth.uid().
-- Role membership is a database privilege, not a caller-controlled session setting.
-- Legacy authenticated/anonymous readers keep the same destination restrictions.
do $$ declare tab text;
begin
  foreach tab in array array['channels','threads','tasks','messages','artifacts','beats','runs','decisions','memory_blocks','facts','schedules','content_items','connectors','whiteboards','code_sessions','reply_reminders','events'] loop
    execute format('alter policy destination_restricted_read on %I using (
      coalesce(pg_has_role(current_user,to_regrole(''nm_runtime''),''member''),false)
      or not nm_marketing_row(workspace_id,%L,to_jsonb(%I))
      or nm_destination_access(workspace_id,''human'',auth.uid(),''marketing''))',tab,tab,tab);
  end loop;
end $$;
