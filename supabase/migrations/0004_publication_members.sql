-- workspace_members joins the publication: sync streams scope by membership
-- (with: CTE + auth.user_id() in sync rules). Guarded for reruns.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'workspace_members') then
    alter publication powersync add table public.workspace_members;
  end if;
end $$;
