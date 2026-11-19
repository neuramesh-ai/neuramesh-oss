-- Keep historical agent conversations; only one is the current home for each project/agent.
alter table threads add column home_root_thread_id uuid references threads(id);
drop index threads_project_agent_home;
create unique index threads_project_agent_home on threads(project_id,home_agent_id)
  where home_agent_id is not null and archived_at is null;

-- Progress follows the current home while origin_thread_id remains the original request audit trail.
create or replace function nm_coding_task_report(p_task uuid, p_source text, p_state text, p_detail text default '') returns void language plpgsql as $$
declare t record; old coding_task_progress%rowtype; line text; summary text; important boolean;
begin
  -- Serialize progress delivery with the human's conversation switch. The task keeps its origin.
  perform pg_advisory_xact_lock(hashtextextended('team-home:' || origin.project_id || ':' || origin.home_agent_id,0))
    from tasks k join threads origin on origin.id=k.origin_thread_id where k.id=p_task and origin.home_agent_id is not null;
  select k.*, h.home_agent_id as parent_agent, h.id as parent_thread into t
    from tasks k join threads origin on origin.id=k.origin_thread_id
    join threads h on h.project_id=origin.project_id and h.home_agent_id=origin.home_agent_id and h.archived_at is null
    join threads c on c.task_id=k.id and c.kind='coding'
    where k.id=p_task and h.home_agent_id is not null and h.archived_at is null;
  if not found then return; end if;
  insert into coding_task_progress(task_id) values(p_task) on conflict do nothing;
  select * into old from coding_task_progress where task_id=p_task for update;
  important := p_source='task' or p_state in ('awaiting_approval','error','completed');
  if p_source='task' and old.task_state is not distinct from p_state then return; end if;
  if p_source='runtime' and old.runtime_state is not distinct from p_state and old.detail is not distinct from p_detail then return; end if;
  if not important and old.reported_at > now()-interval '60 seconds' then return; end if;
  line := case when p_source='task' then case p_state
      when 'plan_review' then 'The implementation plan is ready to review below.'
      when 'plan_approved' then 'Your implementation plan approval is saved. The developer is preparing the coding runtime.'
      when 'in_progress' then 'The coding agent has picked up the approved implementation. I am tracking its progress here.'
      when 'in_review' then 'Implementation is submitted for review. The coding task contains the changes and verification results.'
      when 'done' then 'Code review has finished; the task is ready for your acceptance.'
      when 'accepted' then 'The implementation has been accepted.'
      when 'blocked' then 'Implementation is blocked. Open the coding task for the blocker and next action.'
      when 'closed' then 'The coding task was stopped or closed.'
      else 'The coding task is now ' || replace(p_state,'_',' ') || '.' end
    else case p_state
      when 'awaiting_approval' then 'The coding agent needs your approval before it can continue. Open the live review below.'
      when 'error' then 'The coding runtime reported an error. I am keeping the task open for follow-up.'
      when 'completed' then 'The coding runtime finished its turn. Submission and review are still tracked separately.'
      else 'Implementation update: ' || coalesce(nullif(left(p_detail,600),''),'the coding agent is working in the task thread.') end end;
  if p_source='task' and p_state='in_review' then
    select left(regexp_replace(body,'```[^`]*```','','g'),3000) into summary from messages where task_id=p_task and author_kind='agent' and body like 'Pushed %' order by created_at desc limit 1;
    if summary is not null then line := line || E'\n\n' || summary; end if;
  end if;
  if p_source='task' and nullif(t.pr_url,'') is not null then line := line || E'\n\n[Open pull request](' || t.pr_url || ')'; end if;
  insert into messages(workspace_id,channel_id,thread_id,author_kind,author_id,body)
    values(t.workspace_id,t.channel_id,t.parent_thread,'agent',t.parent_agent,
      '#' || t.number || ' · ' || t.title || E'\n\n' || line ||
      case when p_source='task' and p_state='plan_review' and t.work_plan is not null then E'\n‹plan:' || p_task || ':v' || coalesce(t.work_plan->>'version','1') || '›'
        when p_state in ('awaiting_approval','error','blocked') then E'\n‹task:' || p_task || '›' else '' end);
  update threads set updated_at=now() where id=t.parent_thread;
  update coding_task_progress set task_state=case when p_source='task' then p_state else task_state end,
    runtime_state=case when p_source='runtime' then p_state else runtime_state end,
    detail=p_detail, reported_at=now() where task_id=p_task;
end $$;
