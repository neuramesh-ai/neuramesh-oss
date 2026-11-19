-- PROJECT MEMORY (decision D15, round 8). Rooms are gone from the product. Memory belongs to the project,
-- and every agent of the project recalls it.
--
-- Before this file:
--   · memory_blocks held one 'channel_summary' row per channel (project_id null).
--   · facts had project_id (0157), but recall and the reconcile read facts by channel_id.
-- After this file:
--   · memory_blocks takes the kind 'project_summary': one row per project, keyed by the existing unique
--     index memory_blocks_project (project_id, kind). channel_id names the project's context channel, so
--     the NOT NULL column and every old reader that joins channels still work.
--   · facts.project_id is filled for every fact (the guard from 0157 fills it on every new write).
--   · the old 'channel_summary' rows stay as they are, so an old nm-api or an old machine in a rolling
--     deploy reads and writes the same rows as before.
--
-- The backfill is a function, nm_project_memory_backfill(workspace or null for all), so the pg lane can test it on seeded rows and
-- an operator can run it again after the deploy (an old nm-api can still write a channel row). It is
-- idempotent: a second run changes nothing.
--
-- Locks:
--   · the kind CHECK is replaced: DROP and ADD CONSTRAINT take ACCESS EXCLUSIVE on memory_blocks. The table
--     holds one small row per channel, so VALIDATE reads it in milliseconds. lock_timeout stops the file
--     instead of queueing readers behind a long writer.
--   · every ALTER on memory_blocks comes before the INSERT. memory_blocks has the deferred sync_change
--     trigger (0159), and an ALTER after a write in the same transaction fails with "pending trigger events".
--   · the facts UPDATE takes row locks only. facts is not a synced table.
set local lock_timeout = '5s';

do $kind$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.memory_blocks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.memory_blocks drop constraint %I', c);
  end loop;
end $kind$;
alter table public.memory_blocks add constraint memory_blocks_kind_check
  check (kind in ('channel_summary', 'project_brief', 'project_summary')) not valid;
alter table public.memory_blocks validate constraint memory_blocks_kind_check;

comment on column public.memory_blocks.kind is
  'project_summary: the project memory block (one per project, project_id set). channel_summary: legacy per-channel block, read only as a fallback';

create or replace function public.nm_project_memory_backfill(p_workspace uuid default null) returns jsonb language plpgsql as $$
declare
  facts_done int;
  blocks_done int;
begin
  -- 1. facts: the project of the channel the fact was written in
  update public.facts f set project_id = c.project_id
    from public.channels c
   where c.id = f.channel_id and f.project_id is null and c.project_id is not null
     and (p_workspace is null or f.workspace_id = p_workspace);
  get diagnostics facts_done = row_count;

  -- 2. blocks: one project_summary per project that has channel summaries and no project block yet. The
  --    content joins the channel summaries, newest first, inside the 4000-character cap of the command.
  --    updated_at is the newest source row, so the refresh sees every message after it as new.
  insert into public.memory_blocks (workspace_id, channel_id, project_id, kind, content, basis_count, updated_at)
  select s.workspace_id, coalesce(p.context_channel_id, s.newest_channel), s.project_id, 'project_summary',
         left(s.content, 4000), s.basis, s.updated_at
    from (
      select c.project_id, min(b.workspace_id::text)::uuid as workspace_id,
             string_agg(b.content, E'\n\n' order by b.updated_at desc) as content,
             sum(b.basis_count)::int as basis, max(b.updated_at) as updated_at,
             (array_agg(b.channel_id order by b.updated_at desc))[1] as newest_channel
        from public.memory_blocks b
        join public.channels c on c.id = b.channel_id and c.workspace_id = b.workspace_id
       where b.kind = 'channel_summary' and b.project_id is null and btrim(b.content) <> ''
         and (p_workspace is null or b.workspace_id = p_workspace)
       group by c.project_id
    ) s
    join public.projects p on p.id = s.project_id and p.workspace_id = s.workspace_id
   where not exists (select 1 from public.memory_blocks x where x.project_id = s.project_id and x.kind = 'project_summary')
  on conflict (project_id, kind) where project_id is not null do nothing;
  get diagnostics blocks_done = row_count;

  return jsonb_build_object('facts', facts_done, 'blocks', blocks_done);
end $$;

comment on function public.nm_project_memory_backfill(uuid) is
  'D15: fill facts.project_id from the channel, and seed one project_summary block per project from its channel summaries. One workspace, or all when null. Idempotent';

select public.nm_project_memory_backfill();
