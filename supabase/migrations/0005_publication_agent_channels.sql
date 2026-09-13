-- agent_channels joins the sync set: the AgentHost needs each agent's
-- channel registrations locally to scope mention wakes. Guarded for reruns.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'agent_channels') then
    alter publication powersync add table public.agent_channels;
  end if;
end $$;
