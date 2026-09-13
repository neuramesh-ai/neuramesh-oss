-- Publish nm_users so cloud PowerSync can JOIN it in the workspace parameter query
-- (map the auth provider's JWT sub → our internal uuid). It is NOT in any sync-rule
-- data query, so it never reaches a client — replicated only for the server-side
-- join. Cloud-only (the dev stack gets the full publication from 99-publication.sql).
-- Guarded for reruns.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'nm_users') then
    alter publication powersync add table public.nm_users;
  end if;
end $$;
