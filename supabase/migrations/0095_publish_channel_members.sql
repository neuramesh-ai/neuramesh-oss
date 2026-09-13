-- channel_members joins the sync set (0094): the rail reads a room's people roster locally, so
-- it renders offline like the rest of the nav. Guarded for reruns.
--
-- Kept as its own *publish*-named migration on purpose — the CI bootstrap skips publication
-- migrations by filename and creates the publication wholesale at the end
-- (dev/stack/init/99-publication.sql), so an `alter publication` inside a normally-named
-- migration would run before the publication exists.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'channel_members') then
    alter publication powersync add table public.channel_members;
  end if;
end $$;
