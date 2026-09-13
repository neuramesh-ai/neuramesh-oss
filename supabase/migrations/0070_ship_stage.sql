-- The ship stage (docs/23): a release gate BETWEEN reviewer-approve and merge.
-- Adds the shipping/ship_review/releasing task states, the 'shipper' agent role,
-- the 'ship' artifact kind (the readiness report, markdown), tasks.ship_plan
-- (the structured, owner-tagged checklist — mutated only via commands so every
-- tick serializes through the server), projects.ship_gate (ON by default; the
-- gate arms only for PR-backed tasks, so non-repo projects are untouched), and
-- the guard pairs. Mirrors packages/shared/src/states.ts TRANSITIONS — two
-- sources, one law. approve_ship_plan is human-only and execute_ship requires
-- an approved plan + a cleared checklist; those actor/structural guards live in
-- the control-api (evaluateTransition) — this trigger is the defense-in-depth
-- pair check, same split as 0052's design gate.
alter type task_state add value if not exists 'shipping';
alter type task_state add value if not exists 'ship_review';
alter type task_state add value if not exists 'releasing';
alter type agent_role add value if not exists 'shipper';
alter type artifact_kind add value if not exists 'ship';

alter table tasks add column if not exists ship_plan jsonb;
alter table projects add column if not exists ship_gate boolean not null default true;

create or replace function nm_task_state_guard() returns trigger language plpgsql as $$
begin
  if old.state = new.state then
    return new;
  end if;
  if (old.state, new.state) in (
    ('backlog', 'todo'), ('backlog', 'closed'),
    ('todo', 'in_progress'), ('todo', 'closed'),
    ('todo', 'designing'), ('designing', 'design_review'), ('design_review', 'designing'),
    ('design_review', 'planning'), ('designing', 'closed'), ('design_review', 'closed'),
    ('todo', 'planning'), ('planning', 'plan_review'), ('plan_review', 'planning'),
    ('plan_review', 'in_progress'), ('planning', 'closed'), ('plan_review', 'closed'),
    ('in_progress', 'blocked'), ('planning', 'blocked'), ('designing', 'blocked'), ('in_review', 'blocked'),
    ('shipping', 'blocked'),
    ('blocked', 'in_progress'), ('blocked', 'planning'), ('blocked', 'designing'), ('blocked', 'in_review'),
    ('blocked', 'shipping'),
    ('blocked', 'closed'),
    ('in_progress', 'in_review'), ('in_progress', 'closed'), ('in_review', 'in_progress'),
    ('in_review', 'done'), ('in_review', 'closed'), ('done', 'closed'),
    ('done', 'in_progress'), ('done', 'accepted'), ('accepted', 'closed'),
    ('done', 'shipping'), ('shipping', 'ship_review'), ('ship_review', 'shipping'),
    ('ship_review', 'releasing'), ('releasing', 'accepted'), ('ship_review', 'accepted'),
    ('ship_review', 'in_progress'), ('releasing', 'in_progress'),
    ('shipping', 'closed'), ('ship_review', 'closed'), ('releasing', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
