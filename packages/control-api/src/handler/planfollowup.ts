// Plan + routine follow-ups that run AFTER the FSM mutate committed (2026-08-19).
// Two side effects share this module because they share a shape: read the settled outcome,
// act fail-soft (the transition that just committed must never be undone by its follow-up).
//   · a plan message — the ‹plan:vN› marker both thread renderers swap for the review card —
//     posted at birth (createtask.ts) and on every propose_plan revision (handler.ts);
//   · the routine auto-accept — a routine-born unit passes its LAST gate the moment review
//     lands it done, server-verified like execute_ship's path.
import { createEvent, formatAddress, planRefMarker, type Actor, type Task } from '@neuramesh/shared';
import type { Command } from '../commands';
import type { MutationResult, Store } from '../store';
import { actorAddress, taskTarget } from './guards';
import { DomainError } from '../errors';
import { implementationPlanName } from './fsm';

/** the ONE plan-message poster: body prose + the ‹plan:vN› marker, onto the task's thread */
export async function postPlanMessage(store: Store, task: Task, actor: Actor, version: number, prose: string): Promise<void> {
  await store
    .postMessage(
      {
        id: crypto.randomUUID(),
        workspace: task.workspace,
        channel: task.channel,
        taskId: task.id,
        threadId: null,
        author: { kind: actor.kind, id: actor.id },
        body: `${prose}\n${planRefMarker(version)}`,
        createdAt: new Date().toISOString(),
      },
      createEvent({
        type: 'message.posted',
        source: actorAddress(actor),
        target: taskTarget(task),
        workspace: task.workspace,
        payload: { preview: `implementation plan v${version} — #${task.number}` },
      }),
    )
    .catch(() => {});
}

/** propose_plan materialized implementation-plan-vN.md — post the thread message that renders its card */
export async function planRevisionFollowup(store: Store, actor: Actor, cmd: Command, outcome: MutationResult): Promise<void> {
  if (cmd.type !== 'task.propose_plan' || !outcome.events.length || !outcome.task.workPlan) return;
  const v = outcome.task.workPlan.version;
  await postPlanMessage(store, outcome.task, actor, v, `Implementation plan **v${v}** (revised) — ${implementationPlanName(v)}`);
}

/** Routines are hands-off through the PLAN gate too (2026-08-22, founder report: a routine-born
 * unit reached plan_review by the board route — promoted todo → request_plan — and parked there
 * waiting for a human who is not in this loop). Same stamps approvePlan writes, sourced to the
 * routine machine; floored like routineAccept: never repo-backed. */
export function routinePlanApprove(task: Task, scheduleId: string): MutationResult {
  if (task.state !== 'plan_review') throw new DomainError('ILLEGAL_TRANSITION', `a routine plan auto-approve fires from plan_review, not ${task.state}`);
  if (task.repo) throw new DomainError('NOT_PERMITTED', 'repo-backed plans are approved by a human, routine or not');
  if (task.planApprovedAt) return { task, events: [] };
  const next: Task = { ...task, planApprovedAt: new Date().toISOString(), requirementsConfirmed: true, version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.plan_approved',
    source: formatAddress({ kind: 'machine', id: 'routine' }),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { routine: true, scheduleId },
  });
  return { task: next, events: [event] };
}

/** The routine's server-verified accept (2026-08-19): a routine-born unit that passed review is
 * done with nobody in the loop — the handler chains this off `task.approve`, the execute_ship
 * precedent. Floored twice: only from `done`, never repo-backed (code merges on a human). */
export function routineAccept(task: Task, scheduleId: string): MutationResult {
  if (task.state !== 'done') throw new DomainError('ILLEGAL_TRANSITION', `a routine auto-accept fires from done, not ${task.state}`);
  if (task.repo) throw new DomainError('NOT_PERMITTED', 'repo-backed work is accepted by a human, routine or not');
  const next: Task = { ...task, state: 'accepted', version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.accepted',
    source: formatAddress({ kind: 'machine', id: 'routine' }),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { routine: true, scheduleId },
  });
  return { task: next, events: [event] };
}

/**
 * Routines are hands-off through the LAST gate too (founder report): a unit whose origin
 * thread carries a schedule_id (0119) auto-accepts when review lands it `done` — the human
 * gets the "routine finished" push (app.ts routes it off the accepted event's payload) and
 * opens the thread to READ the run, never to unblock it. Floored to repo-less work inside
 * routineAccept: code still merges only on a human's accept.
 */
export async function routineAcceptFollowup(store: Store, cmd: Command & { taskId: string }, outcome: MutationResult): Promise<MutationResult> {
  if (cmd.type !== 'task.approve' || outcome.task.state !== 'done' || outcome.task.repo || !outcome.task.originThreadId) return outcome;
  const scheduleId = await store.getThreadScheduleId(outcome.task.workspace, outcome.task.originThreadId).catch(() => null);
  if (!scheduleId) return outcome;
  const accepted = await store.mutate(cmd.taskId, async (t) => routineAccept(t, scheduleId)).catch(() => null);
  return accepted ? { ...accepted, events: [...outcome.events, ...accepted.events] } : outcome;
}

/** Routines are hands-off through the PLAN gate too (2026-08-22): a propose_plan that lands a
 * repo-less, routine-anchored task in plan_review auto-approves server-side — the plan card
 * renders already-approved, and the claim watch releases the work with nobody parked. Covers
 * the board-born route (promoted todo → request_plan) that the birth-time stamp cannot see. */
export async function routinePlanFollowup(store: Store, cmd: Command, outcome: MutationResult): Promise<MutationResult> {
  if (cmd.type !== 'task.propose_plan' || outcome.task.state !== 'plan_review' || outcome.task.planApprovedAt || outcome.task.repo || !outcome.task.originThreadId) return outcome;
  const scheduleId = await store.getThreadScheduleId(outcome.task.workspace, outcome.task.originThreadId).catch(() => null);
  if (!scheduleId) return outcome;
  const approved = await store.mutate(outcome.task.id, async (t) => routinePlanApprove(t, scheduleId)).catch(() => null);
  return approved ? { ...approved, events: [...outcome.events, ...approved.events] } : outcome;
}

/** Routines are hands-off through the DESIGN gate too (2026-09-16, founder report: #1093's plan
 * declared a design leg, so even an anchored unit would have parked at design_review — approve_design
 * is HUMAN_ONLY and, unlike the plan and the accept, had no routine follow-up). The approve_design
 * fork by plan shape (plan-first → todo, legacy → planning), the round promoted to the library, the
 * assignee cleared — sourced to the routine machine, floored like the rest: never repo-backed. */
export function routineDesignApprove(task: Task, scheduleId: string, round: number): MutationResult {
  if (task.state !== 'design_review') throw new DomainError('ILLEGAL_TRANSITION', `a routine design auto-approve fires from design_review, not ${task.state}`);
  if (task.repo) throw new DomainError('NOT_PERMITTED', 'repo-backed design rounds are approved by a human, routine or not');
  const now = new Date().toISOString();
  const next: Task = { ...task, state: task.workPlan ? 'todo' : 'planning', assignee: null, version: task.version + 1, updatedAt: now };
  const event = createEvent({
    type: 'task.design_approved',
    source: formatAddress({ kind: 'machine', id: 'routine' }),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { routine: true, scheduleId, round },
  });
  return { task: next, events: [event], promoteLatestDesignRound: true };
}

/** A propose_design landing a repo-less, routine-anchored unit in design_review auto-approves
 * server-side and says so in the thread (the plan message's idiom: a real message, authored by the
 * unit's creator, fail-soft) — the human reads a run, never a gate. */
export async function routineDesignFollowup(store: Store, cmd: Command, outcome: MutationResult): Promise<MutationResult> {
  if (cmd.type !== 'task.propose_design' || outcome.task.state !== 'design_review' || outcome.task.repo || !outcome.task.originThreadId) return outcome;
  const scheduleId = await store.getThreadScheduleId(outcome.task.workspace, outcome.task.originThreadId).catch(() => null);
  if (!scheduleId) return outcome;
  const approved = await store.mutate(outcome.task.id, async (t) => routineDesignApprove(t, scheduleId, cmd.round)).catch(() => null);
  if (!approved) return outcome;
  const task = approved.task;
  await store
    .postMessage(
      {
        id: crypto.randomUUID(), workspace: task.workspace, channel: task.channel, taskId: task.id, threadId: null,
        author: { kind: task.creator.kind, id: task.creator.id },
        body: `✓ Design round ${cmd.round} auto-approved · routine run. The round is the visual contract for the work. The build starts now.`,
        createdAt: new Date().toISOString(),
      },
      createEvent({ type: 'message.posted', source: formatAddress({ kind: 'machine', id: 'routine' }), target: taskTarget(task), workspace: task.workspace, payload: { preview: `design round ${cmd.round} auto-approved — #${task.number}` } }),
    )
    .catch(() => {});
  return { ...approved, events: [...outcome.events, ...approved.events] };
}
