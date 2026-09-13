-- Release verification (docs/23 v2): `accepted` now MEANS "merged and the
-- release verified", not "merge scheduled". execute_ship lands in the new
-- `verifying` state, where the merging host squash-merges the PR and then
-- watches the release actually land — post-merge CI on the merge commit plus
-- any release workflows it triggered — before sending confirm_release
-- (verifying -> accepted). A red or hung verdict holds the task in verifying
-- with the evidence in the thread; the human's direct accept stays legal from
-- verifying (paved road, never a cage), and request_changes bounces a failed
-- release into a fix-forward round. Mirrors packages/shared/src/states.ts
-- TRANSITIONS — two sources, one law; actor/structural guards live in the
-- control-api (evaluateTransition), this trigger stays the defense-in-depth
-- pair check (same split as 0070's ship gate).
alter type task_state add value if not exists 'verifying';

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
    ('shipping', 'closed'), ('ship_review', 'closed'), ('releasing', 'closed'),
    ('in_progress', 'done'), ('todo', 'done'),
    ('releasing', 'verifying'), ('verifying', 'accepted'),
    ('verifying', 'in_progress'), ('verifying', 'closed')
  ) then
    return new;
  end if;
  raise exception 'illegal task transition: % -> %', old.state, new.state;
end;
$$;
