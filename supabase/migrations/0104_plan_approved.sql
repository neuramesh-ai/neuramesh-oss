-- 0104 — `plan_approved_at`: the implementation-plan gate becomes server law (docs/29 §4d).
--
-- Founder ruling: the orchestrator owns the deliverable and every gate-state move; four sign-offs
-- stay the human's — design approval, IMPLEMENTATION-PLAN approval, ship-plan approval, and accept.
--
-- Three of those were already enforced. This one was not enforced at all: `plan_review ->
-- in_progress` is a plain `claim`, so "the human approved the plan" lived only in the orchestrator's
-- prompt. An agent that ignored the instruction could start building an unapproved plan and nothing
-- structural said no — doctrine §4's definition of an invariant that is not one.
--
-- A FLAG rather than a state, deliberately. The edge it guards must keep working for both paths:
-- the owned path claims plan_review as the assignee (rex), the delegated path claims it as the
-- offered developer. A `plan_review -> approved` state would strand one of the two, since the
-- architect is still the assignee at that point. This is the shape `requirements_confirmed`
-- already uses for the same reason.
--
-- A timestamp, not a boolean, so the row says WHEN — matching ship_plan.approvedAt.

alter table tasks add column if not exists plan_approved_at timestamptz;
