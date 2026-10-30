-- A Team Desk home is an ordinary conversation with a durable owner. All messages,
-- files, decisions and work continue to use their existing storage and renderers.
alter table threads add column home_agent_id uuid references agents(id);
alter table threads add column home_thinking text;
create unique index threads_project_agent_home on threads(project_id, home_agent_id) where home_agent_id is not null;
alter table threads add constraint agent_home_is_chat check
  (home_agent_id is null or (project_id is not null and kind = 'chat' and mode = 'chat' and task_id is null and schedule_id is null));
create function nm_guard_agent_home() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.home_agent_id is not null and
    (new.home_agent_id is distinct from old.home_agent_id or new.project_id is distinct from old.project_id or new.channel_id is distinct from old.channel_id) then
    raise exception 'An agent thread keeps its owner and project.';
  end if;
  if new.home_agent_id is not null and not exists (
    select 1 from agents a join projects p on p.workspace_id = a.workspace_id
    where a.id = new.home_agent_id and p.id = new.project_id and a.workspace_id = new.workspace_id and p.context_channel_id = new.channel_id
  ) then raise exception 'An agent thread must belong to its project and workspace.'; end if;
  return new;
end $$;
create trigger guard_agent_home before insert or update on threads for each row execute function nm_guard_agent_home();

-- Derived context, never a replacement for history. Previous revisions remain available
-- for recovery; publication uses compare-and-swap under the thread lock.
create table team_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  revision integer not null,
  through_message_id uuid not null references messages(id) on delete cascade,
  summary text not null check(length(summary) between 1 and 16000),
  created_at timestamptz not null default now(),
  unique(thread_id, revision)
);
alter table team_context_snapshots enable row level security;
create policy team_context_read on team_context_snapshots for select using (nm_is_member(workspace_id));

-- Only the collaboration endpoint can stamp this field. Normal agent messages never wake
-- another agent, even if their prose contains mentions or looks like a request.
alter table messages add column team_source_thread_id uuid references threads(id) on delete set null;
alter table messages add column team_depth integer check(team_depth between 1 and 3);
alter table messages add constraint team_request_pair check ((team_source_thread_id is null) = (team_depth is null));
alter table schedules add column owner_home_thread_id uuid references threads(id) on delete set null;
create index schedules_agent_home on schedules(owner_home_thread_id) where owner_home_thread_id is not null;
