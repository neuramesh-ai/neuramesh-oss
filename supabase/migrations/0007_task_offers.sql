-- Offers: the orchestrator/human offers a task to a specific agent; claiming
-- stays atomic and voluntary (offer -> claim, not push -> assign; docs/03 §4).
alter table tasks add column offered_agent_id uuid references agents (id) on delete set null;
create index tasks_offers on tasks (offered_agent_id) where offered_agent_id is not null and state = 'todo';
