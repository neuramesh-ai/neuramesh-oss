// THE RETRO'S READS — every query the weekly retrospective runs, and nothing else.
//
// Split out of computeRetro, which was one 320-line function doing two unrelated jobs: asking
// the database fifteen questions, then shaping the answers into cards. This is the first half.
// The shapes are inferred by the caller (`RetroRows`), so adding a query here needs no type
// restated there.
//
// Nothing in here decides anything. Every derivation — levels, first-try rates, the compounding
// curve, the spark buckets — stayed with the assembly, so this file can be read as a list of
// questions and that file as a list of answers.
import type postgres from 'postgres';
import type { retroWindow } from '@neuramesh/shared';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

interface AgentRow {
  id: string;
  name: string;
  role: string;
}

export async function retroRows(a: {
  sql: postgres.Sql;
  workspaceId: string;
  dayStart: number;
  /** the resolved window — INFERRED from retroWindow, never restated */
  w: ReturnType<typeof retroWindow>;
}) {
  const { sql, workspaceId, dayStart, w } = a;
  const [from, to, prevFrom, prevTo] = [iso(w.from), iso(w.to), iso(w.prevFrom), iso(w.prevTo)];

  // active roster only: retired agents drop off the cards, but their history keeps
  // counting — the org row + compounding curve aggregate tasks/events directly, and
  // a rehire (register same name) brings the card back with full history intact.
  const agents = (await sql`
    select id, name, role from agents where workspace_id = ${workspaceId} and retired_at is null order by created_at
  `) as unknown as AgentRow[];

  // accepted per assignee — window, prior window, and cumulative at both window
  // edges (the level derivation needs history "as of" each edge)
  const acceptedRows = (await sql`
    select assignee_id,
      count(*) filter (where accepted_at >= ${from} and accepted_at < ${to}) as cur,
      count(*) filter (where accepted_at >= ${prevFrom} and accepted_at < ${prevTo}) as prev,
      count(*) filter (where accepted_at < ${to}) as cum_end,
      count(*) filter (where accepted_at < ${from}) as cum_start
    from tasks
    where workspace_id = ${workspaceId} and assignee_kind = 'agent' and accepted_at is not null
    group by assignee_id
  `) as unknown as Array<{ assignee_id: string; cur: string; prev: string; cum_end: string; cum_start: string }>;

  // first-try pass per assignee: approvals in window with zero changes_requested
  // events on the task before that approval
  const firstTryRows = (await sql`
    with approved as (
      select t.id, t.assignee_id, t.approved_at,
        (select count(*) from events e
          where e.task_id = t.id and e.type = 'task.changes_requested' and e.ts < t.approved_at) as bounces
      from tasks t
      where t.workspace_id = ${workspaceId} and t.assignee_kind = 'agent' and t.approved_at is not null
        and t.approved_at >= ${prevFrom} and t.approved_at < ${to}
    )
    select assignee_id,
      count(*) filter (where approved_at >= ${from}) as d_cur,
      count(*) filter (where approved_at >= ${from} and bounces = 0) as n_cur,
      count(*) filter (where approved_at < ${prevTo}) as d_prev,
      count(*) filter (where approved_at < ${prevTo} and bounces = 0) as n_prev
    from approved group by assignee_id
  `) as unknown as Array<{ assignee_id: string; d_cur: string; n_cur: string; d_prev: string; n_prev: string }>;

  // reviews given per reviewer (source address) — approved + changes_requested
  const reviewRows = (await sql`
    select substring(source from 7) as agent_id,
      count(*) filter (where ts >= ${from} and ts < ${to}) as cur,
      count(*) filter (where ts >= ${from} and ts < ${to} and type = 'task.changes_requested') as caught_cur,
      count(*) filter (where ts >= ${prevFrom} and ts < ${prevTo}) as prev,
      count(*) filter (where ts >= ${prevFrom} and ts < ${prevTo} and type = 'task.changes_requested') as caught_prev,
      count(*) filter (where ts < ${to}) as cum_end,
      count(*) filter (where ts < ${from}) as cum_start
    from events
    where workspace_id = ${workspaceId} and source like 'agent:%'
      and type in ('task.approved', 'task.changes_requested')
    group by agent_id
  `) as unknown as Array<{ agent_id: string; cur: string; caught_cur: string; prev: string; caught_prev: string; cum_end: string; cum_start: string }>;

  // plans proposed per architect; "approved" = the task was later claimed out of
  // plan_review (claimed_at after the proposal) — the FSM's own approval signal
  const planRows = (await sql`
    select substring(e.source from 7) as agent_id,
      count(*) filter (where e.ts >= ${from} and e.ts < ${to}) as proposed_cur,
      count(*) filter (where e.ts >= ${from} and e.ts < ${to}
        and t.claimed_at is not null and t.claimed_at > e.ts) as approved_cur,
      count(*) filter (where e.ts >= ${from} and e.ts < ${to}
        and t.claimed_at is not null and t.claimed_at > e.ts
        and not exists (select 1 from events r where r.task_id = e.task_id
          and r.type = 'task.plan_revising' and r.ts > e.ts)) as clean_cur,
      count(*) filter (where e.ts >= ${prevFrom} and e.ts < ${prevTo}
        and t.claimed_at is not null and t.claimed_at > e.ts) as approved_prev,
      count(*) filter (where e.ts >= ${prevFrom} and e.ts < ${prevTo}
        and t.claimed_at is not null and t.claimed_at > e.ts
        and not exists (select 1 from events r where r.task_id = e.task_id
          and r.type = 'task.plan_revising' and r.ts > e.ts)) as clean_prev,
      count(*) filter (where e.ts < ${to} and t.claimed_at is not null and t.claimed_at > e.ts) as approved_cum_end,
      count(*) filter (where e.ts < ${from} and t.claimed_at is not null and t.claimed_at > e.ts) as approved_cum_start
    from events e join tasks t on t.id = e.task_id
    where e.workspace_id = ${workspaceId} and e.type = 'task.plan_proposed' and e.source like 'agent:%'
    group by agent_id
  `) as unknown as Array<Record<string, string>>;

  // routed per orchestrator: tasks created by an agent
  const routedRows = (await sql`
    select substring(source from 7) as agent_id,
      count(*) filter (where ts >= ${from} and ts < ${to}) as cur,
      count(*) filter (where ts >= ${prevFrom} and ts < ${prevTo}) as prev
    from events
    where workspace_id = ${workspaceId} and type = 'task.created' and source like 'agent:%'
    group by agent_id
  `) as unknown as Array<{ agent_id: string; cur: string; prev: string }>;

  // lessons: learner = the task's assignee (docs/13 §3 — attribution follows who
  // was corrected, not who recorded); the newest per agent feeds the card line
  const lessonRows = (await sql`
    select t.assignee_id as agent_id,
      count(*) filter (where f.created_at >= ${from} and f.created_at < ${to}) as cur,
      count(*) filter (where f.created_at < ${to}) as cum_end,
      count(*) filter (where f.created_at < ${from}) as cum_start
    from facts f join tasks t on t.id = f.task_id
    where f.workspace_id = ${workspaceId} and f.kind = 'lesson' and t.assignee_kind = 'agent'
    group by t.assignee_id
  `) as unknown as Array<{ agent_id: string; cur: string; cum_end: string; cum_start: string }>;

  const learnedRows = (await sql`
    select distinct on (t.assignee_id) t.assignee_id as agent_id, f.content
    from facts f join tasks t on t.id = f.task_id
    where f.workspace_id = ${workspaceId} and f.kind = 'lesson' and t.assignee_kind = 'agent'
      and f.created_at >= ${from} and f.created_at < ${to}
    order by t.assignee_id, f.created_at desc
  `) as unknown as Array<{ agent_id: string; content: string }>;

  // skills proposed per author
  const skillRows = (await sql`
    select author_id as agent_id,
      count(*) filter (where created_at >= ${from} and created_at < ${to}) as cur,
      count(*) filter (where created_at < ${to}) as cum_end,
      count(*) filter (where created_at < ${from}) as cum_start
    from skills
    where workspace_id = ${workspaceId} and author_kind = 'agent'
    group by author_id
  `) as unknown as Array<{ agent_id: string; cur: string; cum_end: string; cum_start: string }>;

  // activity spark: accepted tasks + reviews per bucket, merged. Buckets are
  // indexed RELATIVE to the window start (w.from), not by absolute UTC day:
  // w.from is anchored to local midnight (retroWindow, dayStart-based), so an
  // absolute floor(epoch/bucketMs) misaligns by the UTC offset and silently
  // drops last-day events past local midnight (they'd land at index bucketCount).
  const sparkAccepted = (await sql`
    select assignee_id as agent_id,
      floor((extract(epoch from accepted_at) * 1000 - ${w.from}) / ${w.bucketMs}) as bucket, count(*) as n
    from tasks
    where workspace_id = ${workspaceId} and assignee_kind = 'agent'
      and accepted_at >= ${from} and accepted_at < ${to}
    group by agent_id, bucket
  `) as unknown as Array<{ agent_id: string; bucket: string; n: string }>;
  const sparkReviews = (await sql`
    select substring(source from 7) as agent_id,
      floor((extract(epoch from ts) * 1000 - ${w.from}) / ${w.bucketMs}) as bucket, count(*) as n
    from events
    where workspace_id = ${workspaceId} and source like 'agent:%'
      and type in ('task.approved', 'task.changes_requested') and ts >= ${from} and ts < ${to}
    group by agent_id, bucket
  `) as unknown as Array<{ agent_id: string; bucket: string; n: string }>;

  // org compounding curve: first-try rate per trailing week, last 8 weeks
  const curveFrom = iso(dayStart + DAY - 8 * 7 * DAY);
  const curveRows = (await sql`
    with approved as (
      select t.approved_at,
        (select count(*) from events e
          where e.task_id = t.id and e.type = 'task.changes_requested' and e.ts < t.approved_at) as bounces
      from tasks t
      where t.workspace_id = ${workspaceId} and t.approved_at >= ${curveFrom} and t.approved_at < ${iso(dayStart + DAY)}
    )
    select floor((extract(epoch from approved_at) * 1000 - ${dayStart + DAY - 8 * 7 * DAY}) / ${7 * DAY}) as wk,
      count(*) as d, count(*) filter (where bounces = 0) as n
    from approved group by wk order by wk
  `) as unknown as Array<{ wk: string; d: string; n: string }>;

  // org stats
  const orgRows = (await sql`
    select
      count(*) filter (where accepted_at >= ${from} and accepted_at < ${to}) as cur,
      count(*) filter (where accepted_at >= ${prevFrom} and accepted_at < ${prevTo}) as prev,
      avg(extract(epoch from (accepted_at - claimed_at)) * 1000)
        filter (where accepted_at >= ${from} and accepted_at < ${to} and claimed_at is not null) as cycle_cur,
      avg(extract(epoch from (accepted_at - claimed_at)) * 1000)
        filter (where accepted_at >= ${prevFrom} and accepted_at < ${prevTo} and claimed_at is not null) as cycle_prev
    from tasks where workspace_id = ${workspaceId} and accepted_at is not null
  `) as unknown as Array<{ cur: string; prev: string; cycle_cur: string | null; cycle_prev: string | null }>;

  const orgLessons = (await sql`
    select count(*) as n from facts
    where workspace_id = ${workspaceId} and kind = 'lesson' and created_at >= ${from} and created_at < ${to}
  `) as unknown as Array<{ n: string }>;

  const lessonList = (await sql`
    select f.content, f.created_at, t.number as task_number, a.name as learner
    from facts f
    left join tasks t on t.id = f.task_id
    left join agents a on a.id = t.assignee_id and t.assignee_kind = 'agent'
    where f.workspace_id = ${workspaceId} and f.kind = 'lesson'
      and f.created_at >= ${from} and f.created_at < ${to}
    order by f.created_at desc limit 12
  `) as unknown as Array<{ content: string; created_at: string; task_number: number | null; learner: string | null }>;

  return { acceptedRows, agents, curveRows, firstTryRows, learnedRows, lessonList, lessonRows, orgLessons, orgRows, planRows, reviewRows, routedRows, skillRows, sparkAccepted, sparkReviews };
}

/** what the assembly reads — inferred, so a new query needs no second declaration */
export type RetroRows = Awaited<ReturnType<typeof retroRows>>;
