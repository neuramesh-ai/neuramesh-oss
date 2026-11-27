-- Upgrade existing Agent Desk handoffs, preserving the approved plan and assigned agent.
-- A pre-existing release plan still belongs to its original shipper until it finishes.
update tasks t set work_plan = work_plan || jsonb_build_object('codingDelivery', jsonb_build_object(
  'visualEvidence', coalesce(t.title ~* 'screenshot' or t.definition_of_done ~* 'screenshot',false),
  'prepareRelease', false))
where t.state not in ('accepted','closed','shipping','ship_review','releasing','verifying')
  and work_plan is not null and not (work_plan ? 'codingDelivery') and t.ship_plan is null
  and exists (select 1 from threads c where c.task_id=t.id and c.kind='coding')
  and exists (select 1 from threads h where h.id=t.origin_thread_id and h.home_agent_id is not null);
