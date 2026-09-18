// THE FSM BOUNDARY — extracted from handler.ts (track C1).
//
// This is the one file that decides whether a transition is legal. It owns the
// command→state table, the subtask gate, the reducer, and the gate mutators that write
// requirement/plan/ship state. Legality itself lives in @neuramesh/shared's TRANSITIONS
// table and is mirrored by the SQL triggers: a change needs all three, never one
// (docs/23 §12 — the ship-stage dead end).
//
// Command branches that do NOT move the FSM belong in domain modules, not here. Keeping
// this file singular is the point: `grep transition(` must have exactly one answer.
import {
  createEvent, evaluateTransition, shipItemsPending, validateWorkPlanLegs,
  shipPlanName, TRANSITION_EVENT,
  type Actor, type NMEvent, type ShipItem, type ShipPlan, type Task, type TaskState,
  type TransitionContext, type TransitionName,
} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import type { MutationResult } from '../store';
import { actorAddress, sameActor, taskTarget } from './guards';

export const TRANSITION_OF: Partial<Record<Command['type'], { to: TaskState; name: TransitionName }>> = {
  'task.claim': { to: 'in_progress', name: 'claim' },
  'task.submit': { to: 'in_review', name: 'submit' },
  'task.request_changes': { to: 'in_progress', name: 'request_changes' },
  'task.approve': { to: 'done', name: 'approve' },
  'task.accept': { to: 'accepted', name: 'accept' },
  'task.block': { to: 'blocked', name: 'block' },
  'task.unblock': { to: 'in_progress', name: 'unblock' },
  'task.cancel': { to: 'closed', name: 'cancel' },
  'task.archive': { to: 'closed', name: 'archive' },
  'task.promote': { to: 'todo', name: 'promote' },
  'task.reopen': { to: 'todo', name: 'reopen' },
  'task.request_plan': { to: 'planning', name: 'request_plan' },
  'task.propose_plan': { to: 'plan_review', name: 'propose_plan' },
  'task.revise_plan': { to: 'planning', name: 'revise_plan' },
  'task.request_design': { to: 'designing', name: 'request_design' },
  'task.propose_design': { to: 'design_review', name: 'propose_design' },
  'task.revise_design': { to: 'designing', name: 'revise_design' },
  'task.approve_design': { to: 'planning', name: 'approve_design' },
  'task.claim_ship': { to: 'shipping', name: 'claim_ship' },
  'task.propose_ship_plan': { to: 'ship_review', name: 'propose_ship_plan' },
  'task.revise_ship_plan': { to: 'shipping', name: 'revise_ship_plan' },
  'task.approve_ship_plan': { to: 'releasing', name: 'approve_ship_plan' },
  'task.execute_ship': { to: 'verifying', name: 'execute_ship' },
  'task.confirm_release': { to: 'accepted', name: 'confirm_release' },
  'task.finish_subtask': { to: 'done', name: 'finish' },
};

// The parent gates that refuse while subtasks are open (docs/24) — the caller
// pre-fetches the live-subtask count for exactly these before the mutation.
export const SUBTASK_GATED = new Set<Command['type']>(['task.submit', 'task.accept', 'task.approve_ship_plan', 'task.execute_ship', 'task.confirm_release']);

// the Definition of Done is editable while the task is still in flight (the bar
// still matters for the pending review). Once accepted/closed — or done, where the
// review already passed — it's frozen. Humans or the orchestrator only.
export const DOD_EDITABLE_STATES = new Set<TaskState>(['backlog', 'todo', 'designing', 'design_review', 'planning', 'plan_review', 'in_progress', 'in_review', 'blocked']);

export function setDefinitionOfDone(task: Task, actor: Actor, dod: string): MutationResult {
  // humans + the orchestrator own the acceptance contract; the architect may set
  // the DoD it derived from its own implementation plan (which the human reviews
  // as part of plan approval before any work starts). Workers/reviewers never do.
  const mayEdit = actor.kind === 'human' || actor.role === 'orchestrator' || actor.role === 'architect';
  if (!mayEdit) throw new DomainError('NOT_PERMITTED', 'the Definition of Done is set by humans, the orchestrator, or the architect');
  if (!DOD_EDITABLE_STATES.has(task.state)) {
    throw new DomainError('ILLEGAL_TRANSITION', `the Definition of Done is frozen once a task is ${task.state}`);
  }
  const next: Task = { ...task, definitionOfDone: dod, version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.dod_set',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    // the contract text isn't secret, but keep the event a metadata pointer
    payload: { length: dod.length },
  });
  return { task: next, events: [event] };
}

// Ship checklist ticks (docs/23). Who may tick what is the whole point:
// humans tick anything (the boss override); the shipper ticks its own and
// delegated-agent items; a delegated agent ticks only its own. An agent can
// NEVER tick a human item — the env var really was set by a person, or the
// box stays empty and execute_ship stays refused. Every tick is a command,
// so the who/when lands in the append-only event log.
export function mayCheckShipItem(actor: Actor, item: ShipItem): boolean {
  if (actor.kind === 'human') return true;
  if (actor.role === 'shipper') return item.owner !== 'human';
  return item.owner === 'agent' && item.agentId === actor.id;
}

export function checkShipItem(task: Task, actor: Actor, cmd: { itemId: string; state: ShipItem['state']; note?: string }): MutationResult {
  // 'verifying' joins 'releasing' (docs/23): the rollout-spine legs (auto merge/verify)
  // are ticked by the host AFTER execute_ship moved the task on
  if (task.state !== 'releasing' && task.state !== 'verifying') {
    throw new DomainError('ILLEGAL_TRANSITION', `the release checklist is live while a task is releasing or verifying — #${task.number} is ${task.state}`);
  }
  const plan = task.shipPlan;
  if (!plan) throw new DomainError('NOT_FOUND', `task ${task.number} has no release plan`);
  const item = plan.items.find((i) => i.id === cmd.itemId);
  if (!item) throw new DomainError('NOT_FOUND', `release checklist item ${cmd.itemId} not found`);
  if (!mayCheckShipItem(actor, item)) {
    throw new DomainError('NOT_PERMITTED', `"${item.title}" is ${item.owner === 'human' ? 'a human step — only a person may check it' : `owned by ${item.owner === 'agent' ? 'its delegated agent or the shipper' : 'the shipper'}`}`);
  }
  const now = new Date().toISOString();
  const items = plan.items.map((i) =>
    i.id === cmd.itemId
      ? {
          ...i,
          state: cmd.state,
          checkedBy: cmd.state === 'pending' ? null : { kind: actor.kind, id: actor.id },
          checkedAt: cmd.state === 'pending' ? null : now,
          note: cmd.note ?? i.note,
        }
      : i,
  );
  const next: Task = { ...task, shipPlan: { ...plan, items }, version: task.version + 1, updatedAt: now };
  const event = createEvent({
    type: 'task.ship_item_checked',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { itemId: cmd.itemId, title: item.title, state: cmd.state, pending: shipItemsPending(next.shipPlan) },
  });
  return { task: next, events: [event] };
}

// Late-found steps append to the live plan (draft while in ship_review, or the
// approved list while releasing — an added item re-arms the execute_ship guard,
// which is exactly the point). Humans, the orchestrator, or the shipper.
export function addShipItem(task: Task, actor: Actor, cmd: { title: string; detail?: string; owner: ShipItem['owner']; agentId?: string }): MutationResult {
  const mayAdd = actor.kind === 'human' || actor.role === 'orchestrator' || actor.role === 'shipper';
  if (!mayAdd) throw new DomainError('NOT_PERMITTED', 'release checklist items are added by humans, the orchestrator, or the shipper');
  if (task.state !== 'ship_review' && task.state !== 'releasing') {
    throw new DomainError('ILLEGAL_TRANSITION', `items can be added while the plan is under review or releasing — #${task.number} is ${task.state}`);
  }
  const plan = task.shipPlan;
  if (!plan) throw new DomainError('NOT_FOUND', `task ${task.number} has no release plan`);
  if (plan.items.length >= 20) throw new DomainError('INVALID_INPUT', 'the release checklist is capped at 20 items');
  const now = new Date().toISOString();
  const item: ShipItem = {
    id: `add-${plan.items.length + 1}-${Date.now().toString(36)}`,
    title: cmd.title,
    detail: cmd.detail ?? '',
    owner: cmd.owner,
    agentId: cmd.owner === 'agent' ? (cmd.agentId ?? null) : null,
    auto: null,
    state: 'pending',
    checkedBy: null,
    checkedAt: null,
    note: '',
  };
  const next: Task = { ...task, shipPlan: { ...plan, items: [...plan.items, item] }, version: task.version + 1, updatedAt: now };
  const event = createEvent({
    type: 'task.ship_item_added',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { itemId: item.id, title: item.title, owner: item.owner },
  });
  return { task: next, events: [event] };
}

// Title/description are the scratch-board surface of a parked idea: editable
// while the task is pre-work (backlog, or todo before anything picks it up).
// From designing onward a stage agent may hold the text as context, so it
// freezes — changed scope becomes a thread note or a new task, never a silent
// rewrite under an in-flight worker.
export const DETAILS_EDITABLE_STATES = new Set<TaskState>(['backlog', 'todo']);

export function updateDetails(task: Task, actor: Actor, cmd: Extract<Command, { type: 'task.update_details' }>): MutationResult {
  const mayEdit = actor.kind === 'human' || actor.role === 'orchestrator';
  if (!mayEdit) throw new DomainError('NOT_PERMITTED', 'task details are edited by humans or the orchestrator');
  if (!DETAILS_EDITABLE_STATES.has(task.state)) {
    throw new DomainError('ILLEGAL_TRANSITION', `details are frozen once a task is ${task.state} — post to the thread instead`);
  }
  if (cmd.title === undefined && cmd.description === undefined && cmd.kind === undefined) {
    throw new DomainError('INVALID_INPUT', 'nothing to update — pass a title, description, and/or kind');
  }
  const next: Task = {
    ...task,
    title: cmd.title ?? task.title,
    description: cmd.description ?? task.description,
    // re-categorize a mis-triaged item while it's still pre-work (docs/16)
    kind: cmd.kind ?? task.kind,
    version: task.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const event = createEvent({
    type: 'task.details_updated',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    // metadata pointer only — the text itself lives on the task row
    payload: { titleChanged: cmd.title !== undefined, descriptionChanged: cmd.description !== undefined },
  });
  return { task: next, events: [event] };
}

// Picking the canvas does not advance the FSM: the task stays in `designing`
// while Iris switches from waiting on the human to drafting. The event is the
// durable round-level choice consumed by every host and client.
export function selectDesignProvider(task: Task, actor: Actor, provider: 'iris' | 'claude-design'): MutationResult {
  if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'the design canvas is chosen by a human');
  if (task.state !== 'designing') {
    throw new DomainError('ILLEGAL_TRANSITION', `the design canvas is chosen after Iris picks up the task — #${task.number} is ${task.state}`);
  }
  const next: Task = { ...task, version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.design_provider_selected',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { provider },
  });
  return { task: next, events: [event] };
}

// The duplicate guard is OPEN-scoped, not time-scoped. It used to also require the sibling
// to be younger than an hour, on the theory that a window was needed so a recurring chore
// ("fix flaky CI" next week) is never blocked — but the OPEN filter already covers that: a
// chore that comes round again has a closed predecessor. The hour bought nothing and cost
// this: a live #1020 sat in design_review for two hours, its owning turn resumed, and the
// same request was created again as #1021 because the window had lapsed. Any task open long
// enough to matter was exactly the one the guard stopped protecting.

export function confirmRequirements(task: Task, actor: Actor, checklist: string[]): MutationResult {
  if (task.state !== 'in_progress') {
    throw new DomainError('ILLEGAL_TRANSITION', 'requirements are confirmed after claiming, before work');
  }
  if (!sameActor(task.assignee, actor)) {
    throw new DomainError('NOT_PERMITTED', 'only the assignee confirms requirements');
  }

  const next: Task = { ...task, requirements: checklist, requirementsConfirmed: true, version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.requirements_confirmed',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { checklist },
  });
  return { task: next, events: [event] };
}

/**
 * A human signs off the implementation plan (docs/29 §4d).
 *
 * HUMAN_ONLY, like the other three gates. Before this the approval was PROMPT ETIQUETTE — the
 * orchestrator was told to wait for the human and then offer, and nothing structural stopped an
 * agent claiming out of plan_review and building an unapproved plan. Doctrine §4: an invariant
 * belongs in the server, not in an instruction a model can talk past.
 *
 * It sets a flag rather than moving the task, because the edge it guards has to stay exactly as it
 * is: the owned path claims it as the assignee, the delegated path claims it as the offered
 * developer, and a state move would strand one of the two.
 */
export function approvePlan(task: Task, actor: Actor): MutationResult {
  if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'implementation-plan approval is a human sign-off');
  if (task.state !== 'plan_review') {
    throw new DomainError('ILLEGAL_TRANSITION', `a plan is approved from plan_review, not ${task.state}`);
  }
  if (task.planApprovedAt) return { task, events: [] }; // idempotent: a double-click is not an error
  // Approving the plan CONFIRMS requirements too (2026-08-17): the human just reviewed the
  // declared journey + subtasks + approach — a strictly stronger sign-off than the intake
  // checklist, and the claim watch's requirements clause must not strand an approved unit.
  const next: Task = { ...task, planApprovedAt: new Date().toISOString(), requirementsConfirmed: true, version: task.version + 1, updatedAt: new Date().toISOString() };
  const event = createEvent({
    type: 'task.plan_approved',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: {},
  });
  return { task: next, events: [event] };
}

export function transition(task: Task, actor: Actor, cmd: Exclude<Command, { type: 'task.create' | 'task.confirm_requirements' | 'task.approve_plan' | 'task.set_definition_of_done' | 'task.update_details' | 'task.select_design_provider' | 'task.check_ship_item' | 'task.add_ship_item' }>, subtasksPending = 0, planVersion = 0, onHumanWord = false): MutationResult {
  const target = TRANSITION_OF[cmd.type];
  if (!target) throw new DomainError('NOT_FOUND', `unknown command ${cmd.type}`);

  // claim is legal from todo (trivial path) or plan_review (the approved,
  // offered, planned task); the FSM rejects any other source state
  if (cmd.type === 'task.claim' && task.state !== 'todo' && task.state !== 'plan_review') {
    throw new DomainError('ALREADY_CLAIMED', `task ${task.number} is ${task.state}`);
  }
  // Plan-first units (2026-08-17): a declared design leg runs BEFORE build — a claim straight
  // out of plan_review would skip it (post-design the unit sits in `todo`, where the claim is
  // legal). Structural, not prompted: the route watch also filters these, but the floor is here.
  if (cmd.type === 'task.claim' && task.state === 'plan_review' && task.workPlan?.legs.includes('design')) {
    throw new DomainError('INVALID_INPUT', `#${task.number} declares a design leg — the design round runs first (request_design); build is claimed after the approved design returns it to todo`);
  }
  // subtasks skip the requirements ritual entirely (they don't submit at all —
  // the lean-FSM guard below answers with the honest rejection)
  if (cmd.type === 'task.submit' && !task.requirementsConfirmed && task.parentTaskId === null) {
    throw new DomainError('REQUIREMENTS_NOT_CONFIRMED', 'confirm requirements before submitting');
  }

  // unblock returns to the stage the task was blocked FROM (stamped below) —
  // legacy blocked rows with no stamp keep the historical in_progress return
  // approve_design forks by plan shape (2026-08-17): a plan-first unit already HAS its
  // implementation plan, so an approved design releases it to `todo` for the build offer;
  // a legacy task continues into planning for the architect. Same mechanism as unblock:
  // the handler picks the edge, the FSM table carries both.
  const to = cmd.type === 'task.unblock'
    ? (task.blockedFrom ?? target.to)
    : cmd.type === 'task.approve_design' && task.workPlan
      ? 'todo'
      : target.to;

  const claiming = cmd.type === 'task.claim';
  const ctx: TransitionContext = {
    actor,
    isAssignee: claiming
      ? task.assignee === null || sameActor(task.assignee, actor)
      : sameActor(task.assignee, actor),
    isCreator: sameActor(task.creator, actor),
    // Reviewer-pool membership comes from the channel registry once the DB
    // layer lands (week 2); until then the agent's role is the pool.
    isReviewerPoolMember: actor.kind === 'agent' && actor.role === 'reviewer',
    artifactCount: cmd.type === 'task.submit' ? cmd.artifacts.length : task.artifactCount,
    repoBacked: task.repo !== null,
    pushedSha: cmd.type === 'task.submit' ? (cmd.sha ?? null) : task.submittedSha,
    // ship gate (docs/23): execute_ship is structurally refused until the plan is
    // human-approved and every checklist item is checked or n/a
    shipPlanApproved: task.shipPlan?.status === 'approved',
    planApproved: !!task.planApprovedAt,
    shipItemsPending: shipItemsPending(task.shipPlan),
    // subtasks (docs/24): a subtask row lives the lean claim/finish/cancel life;
    // a parent with open subtasks can't pass its next gate
    isSubtask: task.parentTaskId !== null,
    subtasksPending,
    // setup flows: a setup task is a human checklist — finish/cancel only
    isSetup: task.kind === 'setup',
    // plan-first units (2026-08-17): an approved work plan that omits review makes this a
    // lean unit — finish is its road to the accept gate (never repo-backed, by validation)
    leanUnit: !!task.workPlan && !task.workPlan.legs.includes('review') && task.parentTaskId === null,
    // accept on the human's word (2026-09-08): proven by the handler against the thread, never claimed
    onHumanWord,
  };

  // the command's intent name disambiguates edges two transitions share
  // (releasing -> accepted: the shipper's execute_ship vs the human's accept)
  const verdict = evaluateTransition(task.state, to, ctx, target.name);
  if (!verdict.ok) throw new DomainError(verdict.code, verdict.reason);

  const now = new Date().toISOString();
  const next: Task = { ...task, state: to, version: task.version + 1, updatedAt: now };
  if (verdict.spec.name === 'block') next.blockedFrom = task.state;
  if (verdict.spec.name === 'unblock') next.blockedFrom = null;

  if (verdict.spec.name === 'claim') next.assignee = { kind: actor.kind, id: actor.id };
  // request_plan assigns the task to the named architect, so the board/thread show who's planning
  // it (not "unassigned") from the moment it enters planning. `architect` is the resolved architect
  // agent id (the orchestrator's request_plan tool looks it up for the channel).
  if (verdict.spec.name === 'request_plan' && cmd.type === 'task.request_plan' && cmd.architect) next.assignee = { kind: 'agent', id: cmd.architect };
  // request_design mirrors request_plan: the resolved channel designer becomes the assignee
  // while the mockups are drafted. approve_design hands off to planning with the assignee
  // CLEARED — the human's button can't know the architect; the architect watch self-selects
  // by role and announces itself in the thread.
  if (verdict.spec.name === 'request_design' && cmd.type === 'task.request_design' && cmd.designer) next.assignee = { kind: 'agent', id: cmd.designer };
  if (verdict.spec.name === 'approve_design') next.assignee = null;
  // routing must categorize the task (docs/16): use the command's kind, else one already
  // set; refuse if still null. NEVER a route gate — any kind may take either route; we
  // only require that the label exists so no task is routed uncategorized.
  if (cmd.type === 'task.request_plan' || cmd.type === 'task.request_design') {
    const k = cmd.kind ?? task.kind;
    if (!k) throw new DomainError('INVALID_INPUT', `categorize #${task.number} (set a kind: bug/feature/…) before routing it`);
    next.kind = k;
  }
  if (verdict.spec.name === 'submit' && cmd.type === 'task.submit') {
    next.artifactCount = task.artifactCount + cmd.artifacts.length;
    next.submittedSha = cmd.sha ?? null;
    // carry the PR pointer when the branch opened one (push-only otherwise)
    if (cmd.prUrl) next.prUrl = cmd.prUrl;
    if (cmd.prNumber) next.prNumber = cmd.prNumber;
  }
  if (verdict.spec.name === 'propose_plan') next.artifactCount = task.artifactCount + 1;
  if (verdict.spec.name === 'propose_design' && cmd.type === 'task.propose_design') next.artifactCount = task.artifactCount + cmd.mockups.length;

  const events: NMEvent[] = [
    createEvent({
      type: TRANSITION_EVENT[verdict.spec.name],
      source: actorAddress(actor),
      target: taskTarget(task),
      workspace: task.workspace,
      payload: payloadFor(cmd),
    }),
  ];

  if (verdict.spec.name === 'submit' && cmd.type === 'task.submit') {
    events.push(
      createEvent({
        type: 'task.review_requested',
        source: actorAddress(actor),
        target: taskTarget(task),
        workspace: task.workspace,
        payload: { dispatch: 'auto', pool: 'channel-reviewers' },
        inReplyTo: events[0]!.id,
      }),
    );
    return { task: next, events, artifacts: cmd.artifacts };
  }

  if (verdict.spec.name === 'propose_plan' && cmd.type === 'task.propose_plan') {
    // Version each proposed plan so a revise produces a distinct, clearly-labeled
    // artifact rather than a second same-named file. The version is derived from the
    // EXISTING PLAN NAMES (executeCommand, nextPlanVersion) — not artifactCount, which
    // design mockups inflate and which made a design-gated task's first plan "v3".
    const name = implementationPlanName(planVersion || nextPlanVersion([]));
    // Plan-first units (2026-08-17): a re-propose may revise the declared STRUCTURE too —
    // legs + proposed subtasks — floored exactly like the create, and it ALWAYS clears the
    // prior approval: a changed plan is a new plan, and the human signs the new one.
    if (cmd.legs || task.workPlan) {
      const legs = cmd.legs ?? task.workPlan?.legs ?? ['build', 'review'];
      const bad = validateWorkPlanLegs(legs, task.repo !== null);
      if (bad) throw new DomainError('INVALID_INPUT', bad);
      next.workPlan = {
        legs: [...legs],
        subtasks: cmd.subtasks ?? task.workPlan?.subtasks ?? [],
        approach: cmd.plan,
        version: (task.workPlan?.version ?? 0) + 1,
        proposedAt: now,
      };
      next.planApprovedAt = null;
    }
    return { task: next, events, artifacts: [{ kind: 'doc', name, content: cmd.plan }] };
  }

  if (verdict.spec.name === 'propose_design' && cmd.type === 'task.propose_design') {
    // Each mockup lands as its own versioned 'design' artifact so a revise round
    // produces distinct files (round = prior proposals + 1, computed by the host).
    const artifacts = cmd.mockups.map((m) => ({ kind: 'design', name: designMockupName(cmd.round, m.name), content: m.html }));
    return { task: next, events, artifacts };
  }

  if (verdict.spec.name === 'approve_design') {
    // the approved (latest) round joins the channel artifact library — curation is
    // structural, not a prompt: the store promotes it in the same transaction
    return { task: next, events, promoteLatestDesignRound: true };
  }

  if (verdict.spec.name === 'propose_ship_plan' && cmd.type === 'task.propose_ship_plan') {
    // the readiness REPORT rides as a versioned 'ship' artifact (renders in the
    // artifact panel, offline, any machine); the structured checklist lands on the
    // task row itself, mutated only through commands so every tick serializes.
    const now = new Date().toISOString();
    const plan: ShipPlan = {
      round: cmd.round,
      risk: cmd.risk,
      summary: cmd.summary,
      status: 'draft',
      // a fresh draft answers every redraft request so far — the counter restarts
      // with the plan object it belongs to
      revisions: 0,
      shipperId: actor.id,
      approvedBy: null,
      approvedAt: null,
      items: cmd.items.map((i) => ({
        id: i.id,
        title: i.title,
        detail: i.detail,
        owner: i.owner,
        agentId: i.owner === 'agent' ? (i.agentId ?? null) : null,
        auto: i.auto ?? null,
        // host-verified items (CI already settled green) may arrive pre-checked
        state: i.state,
        checkedBy: i.state === 'done' ? { kind: actor.kind, id: actor.id } : null,
        checkedAt: i.state === 'done' ? now : null,
        note: i.note,
      })),
    };
    next.shipPlan = plan;
    next.artifactCount = task.artifactCount + 1;
    return { task: next, events, artifacts: [{ kind: 'ship', name: shipPlanName(cmd.round), content: cmd.report }] };
  }

  // a redraft request stamps the plan so the host's shipper watch re-enters the
  // draft flow. Load-bearing for the SELF-LOOP (shipping -> shipping): the row's
  // state doesn't change there, so this stamp is the only thing that tells the
  // watch "this is a new request, not the one you already prepped".
  if (verdict.spec.name === 'revise_ship_plan' && task.shipPlan) {
    next.shipPlan = { ...task.shipPlan, status: 'draft', revisions: (task.shipPlan.revisions ?? 0) + 1 };
  }

  if (verdict.spec.name === 'approve_ship_plan') {
    if (!task.shipPlan) throw new DomainError('NOT_FOUND', `task ${task.number} has no release plan to approve`);
    next.shipPlan = { ...task.shipPlan, status: 'approved', approvedBy: actor.id, approvedAt: new Date().toISOString() };
    // the approved plan joins the channel library like an approved design round
    return { task: next, events, promoteLatestShipRound: true };
  }

  if (verdict.spec.name === 'finish' && cmd.type === 'task.finish_subtask') {
    // a subtask's deliverables land on the PARENT — the reviewer and the ship
    // gate see one evidence set; the subtask row itself stays artifact-less
    const arts = (cmd.artifacts ?? []).map((a) => ({ kind: a.kind, name: a.name, content: a.content }));
    if (arts.length) {
      // a subtask's deliverables land on the PARENT; a top-level LEAN unit (plan-first,
      // review declared away) keeps its own — before 2026-08-17 they were silently dropped
      return { task: next, events, artifacts: arts, ...(task.parentTaskId ? { artifactTaskId: task.parentTaskId } : {}) };
    }
    return { task: next, events };
  }

  // a terminal task (accept ships it, cancel/archive close it) can't still owe the human
  // an answer — dismiss its open nmq cards so they don't linger on Mission Control after
  // the work they asked about is done (docs/12 slice 2). The store flips them atomically.
  if (to === 'accepted' || to === 'closed') return { task: next, events, dismissOpenDecisions: true };

  return { task: next, events };
}

/**
 * The next implementation-plan version, from the plan artifacts that already exist.
 *
 * This used to be the task's running `artifactCount`, on the premise that "during the
 * plan phase the only artifacts are plans". **A design-gated task breaks that premise**:
 * `propose_design` increments the same counter, so #1034's two approved mockups made its
 * FIRST plan `implementation-plan-v3.md`. Meanwhile the daemon announced the plan by
 * counting only plan artifacts — the true ordinal, v1 — so the thread linked a file that
 * did not exist while the artifact list carried v5. One name, two derivations, and on
 * every design→plan task they disagree.
 *
 * Derived from the existing NAMES rather than a count so it is also correct on tasks that
 * already carry the old mis-numbered files: max + 1 can never collide with a v3/v5 a
 * previous release wrote, where count + 1 would.
 */
export function nextPlanVersion(existingNames: readonly string[]): number {
  const highest = existingNames.reduce((max, n) => {
    const v = Number(/^implementation-plan-v(\d+)\.md$/i.exec(n)?.[1] ?? 0);
    return v > max ? v : max;
  }, 0);
  return highest + 1;
}

export const implementationPlanName = (version: number): string => `implementation-plan-v${version}.md`;

// design mockup artifact name: versioned by proposal round, slug-safe, .html
// (the preview tier renders 'design' artifacts in the sandboxed iframe by kind).
export function designMockupName(round: number, name: string): string {
  // one dash at each end at most: the collapse before it leaves no run (CodeQL, 2026-09-18)
  const slug = name.toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mockup';
  return `design-mockup-v${round}-${slug}.html`;
}

export function payloadFor(cmd: Command): Record<string, unknown> {
  switch (cmd.type) {
    case 'task.submit':
      // metadata only — artifact content lives in artifact rows, never events
      return { artifacts: cmd.artifacts.map(({ kind, name }) => ({ kind, name })), sha: cmd.sha ?? null };
    case 'task.request_changes':
      return { feedback: cmd.feedback };
    case 'task.revise_plan':
      return { feedback: cmd.feedback };
    case 'task.revise_design':
      return { feedback: cmd.feedback };
    case 'task.revise_ship_plan':
      return { feedback: cmd.feedback };
    case 'task.propose_ship_plan':
      // metadata only — the report markdown lives in the artifact row, never events
      return { round: cmd.round, risk: cmd.risk, items: cmd.items.map(({ id, title, owner }) => ({ id, title, owner })), ...(cmd.summary ? { summary: cmd.summary } : {}) };
    case 'task.finish_subtask':
      // metadata only — artifact content lives in artifact rows on the parent
      return { ...(cmd.note ? { note: cmd.note } : {}), artifacts: (cmd.artifacts ?? []).map(({ kind, name }) => ({ kind, name })) };
    case 'task.confirm_release':
      // the host's one-line verdict summary (checks green, workflows settled) — audit trail
      return cmd.note ? { note: cmd.note } : {};
    case 'task.block':
      return { reason: cmd.reason };
    case 'task.request_plan':
      return { ...(cmd.architect ? { architect: cmd.architect } : {}), ...(cmd.kind ? { kind: cmd.kind } : {}) };
    case 'task.request_design':
      return { ...(cmd.designer ? { designer: cmd.designer } : {}), ...(cmd.kind ? { kind: cmd.kind } : {}), ...(cmd.provider ? { provider: cmd.provider } : {}) };
    case 'task.propose_design':
      // metadata only — mockup HTML lives in artifact rows, never events
      return { round: cmd.round, mockups: cmd.mockups.map((m) => designMockupName(cmd.round, m.name)), ...(cmd.summary ? { summary: cmd.summary } : {}) };
    default:
      return {};
  }
}
