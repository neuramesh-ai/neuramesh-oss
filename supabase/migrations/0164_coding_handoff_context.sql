-- Preserve the developer's explicitly selected home model on unstarted handoffs.
-- Existing task-specific picks, sessions, active work and closed tasks remain untouched.
update threads c set brain_override=h.brain_override, home_thinking=h.home_thinking,
  origin=coalesce(c.origin,h.origin), machine_id=coalesce(c.machine_id,h.machine_id)
from tasks t join threads h on h.project_id=t.project_id and h.workspace_id=t.workspace_id
  and h.home_agent_id=t.offered_agent_id and h.archived_at is null
where c.task_id=t.id and c.kind='coding' and c.created_by=h.created_by
  and c.brain_override is null and h.brain_override is not null
  and t.state in ('todo','planning','plan_review')
  and not exists(select 1 from code_sessions cs where cs.id=c.id);

create or replace function nm_coding_task_report(p_task uuid, p_source text, p_state text, p_detail text default '') returns void language plpgsql as $$
declare t record; old coding_task_progress%rowtype; line text; summary text; important boolean;
begin
  select k.*, h.home_agent_id as parent_agent, h.id as parent_thread into t
    from tasks k join threads h on h.id=k.origin_thread_id
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

create or replace function nm_coding_task_report_trigger() returns trigger language plpgsql as $$
declare task uuid; state text;
begin
  if tg_table_name='tasks' then
    if new.work_plan is distinct from old.work_plan and new.state='plan_review' then
      update coding_task_progress set task_state=null where task_id=new.id;
      perform nm_coding_task_report(new.id,'task','plan_review');
    elsif new.plan_approved_at is not null and old.plan_approved_at is null then
      perform nm_coding_task_report(new.id,'task','plan_approved');
    elsif new.state is distinct from old.state then perform nm_coding_task_report(new.id,'task',new.state::text); end if;
  elsif tg_table_name='threads' then
    if new.kind='coding' and new.task_id is not null then
      select t.state::text into state from tasks t where t.id=new.task_id;
      perform nm_coding_task_report(new.task_id,'task',state);
    end if;
  elsif tg_table_name='runs' then
    if new.task_id is not null and new.kind='work' and new.state='running' then perform nm_coding_task_report(new.task_id,'runtime','working',new.step); end if;
  elsif tg_table_name='code_sessions' then
    select task_id into task from threads where id=new.id;
    -- Routine implementation detail comes from runs.step. last_line is initially the
    -- user's prompt, so echoing it on every streaming transition is not a progress update.
    if task is not null and new.state in ('awaiting_approval','error','completed') then
      perform nm_coding_task_report(task,'runtime',new.state,new.last_line);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists coding_task_state_report on tasks;
create trigger coding_task_state_report after update of state,work_plan,plan_approved_at on tasks for each row execute function nm_coding_task_report_trigger();
drop trigger if exists coding_runtime_report on code_sessions;
create trigger coding_runtime_report after insert or update of state,last_line on code_sessions for each row execute function nm_coding_task_report_trigger();

drop trigger if exists coding_task_started_report on threads;
create trigger coding_task_started_report after insert on threads for each row execute function nm_coding_task_report_trigger();

drop trigger if exists coding_task_work_report on runs;
create trigger coding_task_work_report after update of step on runs for each row execute function nm_coding_task_report_trigger();

-- Unavailable provider cards must be visible to the parent as well as the coding task.
create or replace function nm_coding_task_auth_report() returns trigger language plpgsql as $$
begin
  if new.task_id is not null and new.author_kind='agent' and position('```nmauth' in new.body)>0 then
    perform nm_coding_task_report(new.task_id,'runtime','error','Provider authorization requires attention.');
  end if;
  return new;
end $$;
drop trigger if exists coding_task_auth_report on messages;
create trigger coding_task_auth_report after insert on messages for each row execute function nm_coding_task_auth_report();
