-- Fleet tables join the sync set (presence + roster). Guarded for reruns.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'machines') then
    alter publication powersync add table public.machines;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'agents') then
    alter publication powersync add table public.agents;
  end if;
end $$;
