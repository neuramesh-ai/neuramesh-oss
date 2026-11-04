-- Repair pre-execution coding handoffs that the old phase dispatcher gave to
-- an architect. Active implementations and unrelated specialist tasks stay put.
update tasks t set assignee_kind='agent', assignee_id=t.offered_agent_id
from agents developer
where developer.id=t.offered_agent_id and developer.workspace_id=t.workspace_id
  and developer.role='developer' and developer.retired_at is null
  and t.state in ('todo','planning','plan_review','blocked')
  and t.assignee_id is distinct from t.offered_agent_id
  and (t.assignee_id is null or exists (
    select 1 from agents previous where previous.id=t.assignee_id and previous.role='architect'
  ))
  and exists (select 1 from threads c where c.task_id=t.id and c.kind='coding');

-- Revised-plan follow-ups used a legacy channel slug. Duplicate project slugs
-- could strand the card outside its task's canonical conversation. Keep every
-- message and its identity; repair only unbound messages of coding tasks.
update messages m set channel_id=t.channel_id, thread_id=c.id
from tasks t join threads c on c.task_id=t.id and c.kind='coding'
where m.task_id=t.id and m.workspace_id=t.workspace_id and m.thread_id is null;
