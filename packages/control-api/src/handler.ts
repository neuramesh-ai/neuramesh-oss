import {

  BEAT_PHASE_ROLES,

  createEvent,
  DESIGN_PROVIDER_QUESTION,
  designProviderFromDecision,
  formatAddress,








  type Actor,

  type NMEvent,
  type Task,



} from '@neuramesh/shared';
import type { Command } from './commands';
import { DomainError } from './errors';
import { assertCommandAllowed } from './hosted-gate';

import { onInviteAccepted } from './onauth';
import { type Store } from './store';
import { actorAddress, verifiedEmailFor, taskTarget } from './handler/guards';
import { SUBTASK_GATED, setDefinitionOfDone, checkShipItem, addShipItem, updateDetails, selectDesignProvider, confirmRequirements, approvePlan, transition, nextPlanVersion } from './handler/fsm';
import { planRevisionFollowup, routineAcceptFollowup, routineDesignFollowup, routinePlanFollowup } from './handler/planfollowup';
import { channelCommands } from './handler/channel';
import { workspaceCommands } from './handler/workspace';
import { accountCommands } from './handler/account';
import { agentCommands } from './handler/agent';
import { artifactCommands } from './handler/artifact';
import { connectorCommands } from './handler/connector';
import { contentCommands } from './handler/content';
import { credentialCommands } from './handler/credential';
import { machineCommands } from './handler/machine';
import { provisionForJoin } from './member-machines';
import { syncSeatsForRoster } from './seats';
import { marketingCommands } from './handler/marketing';
import { memberCommands } from './handler/member';
import { memoryCommands } from './handler/memory';
import { messageCommands } from './handler/message';
import { modelpackCommands } from './handler/modelpack';
import { policyCommands } from './handler/policy';
import { projectCommands } from './handler/project';
import { repoCommands } from './handler/repo';
import { scheduleCommands } from './handler/schedule';
import { setupCommands } from './handler/setup';
import { skillCommands } from './handler/skill';
import { skillpackCommands } from './handler/skillpack';
import { threadCommands } from './handler/thread';
import { whiteboardCommands } from './handler/whiteboard';
import { codeSessionCommands } from './handler/codesession';
import { createTask } from './handler/createtask';
// the plan-name helpers are part of handler.ts's public surface (analytics.test.ts reads them)
export { nextPlanVersion, implementationPlanName } from './handler/fsm';











export interface CommandOutcome {
  task: Task;
  events: NMEvent[];
}

/** A command the FSM tail can reduce. `'taskId' in cmd` is not enough — a few commands carry an
 *  OPTIONAL taskId, so the property can exist and still be undefined; the reducer needs a real id. */
function isTaskCommand(c: Command): c is Extract<Command, { taskId: string }> {
  return typeof (c as { taskId?: unknown }).taskId === 'string';
}

export async function executeCommand(
  store: Store,
  actor: Actor,
  cmd: Command,
): Promise<CommandOutcome | { machineId: string }> {
  // the hosted write gate's second door (hosted-gate.ts): a `free` hosted workspace does not write
  await assertCommandAllowed(store, cmd);
  // Domain branches (handler/<domain>.ts). Delegated in one place, before the FSM tail:
  // command types are unique, so matching here is identical to matching where they were.
  { const r = await machineCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await agentCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await memoryCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await artifactCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await accountCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await memberCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await credentialCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await modelpackCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await skillCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await policyCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await skillpackCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await repoCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await projectCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await threadCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await scheduleCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await contentCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await connectorCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await marketingCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await setupCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await whiteboardCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await codeSessionCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await messageCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await workspaceCommands(store, actor, cmd); if (r !== undefined) return r; }
  { const r = await channelCommands(store, actor, cmd); if (r !== undefined) return r; }
  if (cmd.type === 'task.create') return createTask(store, actor, cmd);

  if (cmd.type === 'task.offer') {
    const mayOffer = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayOffer) throw new DomainError('NOT_PERMITTED', 'tasks are offered by humans or the orchestrator');
    const task = await store.getTask(cmd.taskId);
    if (!task) throw new DomainError('NOT_FOUND', `task ${cmd.taskId} not found`);
    // a routed task must be categorized (docs/16) — the kind on this offer, else the
    // one already on the task (e.g. a post-plan hand-off). Never a route gate. Gate on
    // kind only for a genuinely offerable task: a parked/non-offerable one's real problem
    // is that it can't be offered at all, which offerTask surfaces first (state error).
    const kind = cmd.kind ?? task.kind;
    if ((task.state === 'todo' || task.state === 'plan_review') && !kind) {
      throw new DomainError('INVALID_INPUT', 'set a kind (bug/feature/…) before offering — categorize the task');
    }
    // The review floor survives late repo binding (docs/41): a plan validated repo-less could
    // declare review away; binding a repo at OFFER time would produce unreviewed code work.
    // The plan must be amended (revise round) before such an offer can carry a repo.
    if (cmd.repo && task.workPlan && !task.workPlan.legs.includes('review')) {
      throw new DomainError('INVALID_INPUT', `#${task.number}'s plan declares no review leg — repo-backed work cannot skip review; revise the plan to add it before binding a repo`);
    }
    const result = await store.offerTask(cmd.taskId, cmd.offerTo, cmd.repo ?? null, cmd.checklist ?? null, cmd.definitionOfDone ?? null, kind, (agentId) =>
      createEvent({
        type: 'task.offered',
        source: actorAddress(actor),
        target: taskTarget(task),
        workspace: task.workspace,
        payload: { offerTo: cmd.offerTo, agentId, ...(cmd.repo ? { repoId: cmd.repo.id } : {}), ...(cmd.checklist ? { checklist: cmd.checklist } : {}), ...(kind ? { kind } : {}) },
      }),
    );
    return { ok: true, ...result } as never;
  }

  // Beats (docs/17): the working agent declares/advances its ordered steps for the current
  // phase. Gate: an agent whose role owns the task's phase (descriptive — never an FSM gate).
  if (cmd.type === 'beats.declare' || cmd.type === 'beats.advance') {
    if (actor.kind !== 'agent') throw new DomainError('NOT_PERMITTED', 'beats are declared by the working agent, not humans');
    const task = await store.getTask(cmd.taskId);
    if (!task) throw new DomainError('NOT_FOUND', `task ${cmd.taskId} not found`);
    const owners = BEAT_PHASE_ROLES[task.state] ?? [];
    if (!actor.role || !owners.includes(actor.role)) {
      throw new DomainError('NOT_PERMITTED', `only the ${owners.join('/') || 'assigned agent'} may set beats while a task is ${task.state}`);
    }
    if (cmd.type === 'beats.declare') {
      if (cmd.phase !== task.state) throw new DomainError('INVALID_INPUT', `task is ${task.state}, not ${cmd.phase} — declare beats for the current phase`);
      const { runId } = await store.declareBeats(task, actor.role, cmd.items);
      return { ok: true, runId } as never;
    }
    await store.advanceBeat(cmd.taskId, cmd.seq, cmd.status);
    return { ok: true } as never;
  }

  // Runs (docs/29): the durable row behind a stretch of agent work. Agent-written only — a
  // human watches, exactly as with beats. `step`/`settle` are the run OWNER's to write, which
  // is what makes "rex says he's still working" checkable rather than a claim in prose.
  if (cmd.type === 'run.open' || cmd.type === 'run.step' || cmd.type === 'run.settle') {
    if (actor.kind !== 'agent') throw new DomainError('NOT_PERMITTED', 'runs are opened and settled by the working agent, not humans');
    if (cmd.type === 'run.open') {
      const { id, won } = await store.openRun({
        id: cmd.id,
        workspace: cmd.workspace,
        channelId: cmd.channel,
        threadId: cmd.threadId ?? null,
        taskId: cmd.runTaskId ?? null,
        parentRunId: cmd.parentRunId ?? null,
        agentId: actor.id,
        kind: cmd.kind,
        title: cmd.title,
        total: cmd.total,
        step: cmd.step ?? null,
        seat: cmd.seat ?? null,
        triggerMessageId: cmd.triggerMessageId ?? null,
        machineId: cmd.machineId ?? null,
      });
      // `won: false` is the wake lease saying another member's machine is already answering.
      // 200, not an error — a losing host stands down silently, exactly as the losing daemon
      // does on 0060's reply index. It is the normal shape of shared compute, not a failure.
      return { ok: true, runId: id, won } as never;
    }
    const run = await store.getRun(cmd.runId);
    if (!run) throw new DomainError('NOT_FOUND', `run ${cmd.runId} not found`);
    if (run.agentId !== actor.id) throw new DomainError('NOT_PERMITTED', 'only the agent that opened a run may update it');
    if (cmd.type === 'run.step') {
      // a settled run is history — reopening it by writing a step would resurrect a spinner
      // the human already saw close. Silently ignored (a late leg callback is not an error).
      if (run.state !== 'running') return { ok: true } as never;
      await store.stepRun(cmd.runId, { step: cmd.step, done: cmd.done, total: cmd.total });
      return { ok: true } as never;
    }
    await store.settleRun(cmd.runId, cmd.state, cmd.summary ?? null);
    return { ok: true } as never;
  }








  // Decisions (docs/12 slice 2): flip an nmq card's authoritative state. Human-only —
  // agents ask, the human is the tiebreaker; the reply message (the behavioral consumer
  // agents watch) posts separately via /v1/messages. Exactly-once: the store's conditional
  // flip CONFLICTs when another machine already answered.
  if (cmd.type === 'decision.answer' || cmd.type === 'decision.dismiss') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'decisions are answered by a human');
    const status = cmd.type === 'decision.answer' ? ('answered' as const) : ('dismissed' as const);
    const result = await store.answerDecision(
      cmd.decisionId,
      { status, answer: cmd.type === 'decision.answer' ? cmd.answer : null, by: { kind: actor.kind, id: actor.id } },
      (workspace) =>
        createEvent({
          type: cmd.type === 'decision.answer' ? 'decision.answered' : 'decision.dismissed',
          source: actorAddress(actor),
          target: formatAddress({ kind: 'resource', type: 'decision', id: cmd.decisionId }),
          workspace,
          payload: cmd.type === 'decision.answer' ? { answer: cmd.answer } : {},
        }),
      cmd.type === 'decision.answer'
        ? (decision) => {
            if (!decision.taskId || decision.question !== DESIGN_PROVIDER_QUESTION) return null;
            const provider = designProviderFromDecision(cmd.answer, decision.options);
            if (!provider) throw new DomainError('INVALID_INPUT', 'choose one of the available design canvases');
            return (task) => selectDesignProvider(task, actor, provider);
          }
        : undefined,
    );
    return { ok: true, id: result.id } as never;
  }







  // ── answering an invitation (0113) ──────────────────────────────────────────────────────
  // Membership is created HERE and nowhere else. Signing in used to do it as a side effect,
  // which meant an already-signed-in user never got one and a stray invite bound an account to
  // a workspace with no exit. The address check is the whole security property: the invite id
  // travels through an inbox and a URL, so it identifies the invitation, never the invitee.
  if (cmd.type === 'workspace.accept_invite' || cmd.type === 'workspace.decline_invite') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'only the invited person answers an invitation');
    const email = await verifiedEmailFor(store, actor.id);
    if (!email) throw new DomainError('NOT_PERMITTED', 'we could not confirm your verified email address');
    if (cmd.type === 'workspace.decline_invite') {
      const ok = await store.declineInvite(cmd.invite, email);
      if (!ok) throw new DomainError('NOT_FOUND', 'that invitation is no longer open');
      console.log(`invite_declined user=${actor.id} invite=${cmd.invite}`);
      return { ok: true } as never;
    }
    const joined = await store.acceptInvite(cmd.invite, actor.id, email);
    console.log(`invite_accepted user=${actor.id} workspace=${joined.workspaceId} role=${joined.role}`);
    // tell whoever sent it — fire-and-forget, a mail outage must never fail the join
    void onInviteAccepted(store, { ...joined, joinedEmail: email, userId: actor.id });
    // their own cloud machine, born asleep (member-machines plan §3) — fire-and-forget like the mail
    provisionForJoin(store, joined.workspaceId, actor.id);
    syncSeatsForRoster(store, joined.workspaceId); // the seat Stripe bills for follows the roster (F4b)
    return { workspaceId: joined.workspaceId, workspaceName: joined.workspaceName, role: joined.role } as never;
  }

































































  // The tail is the FSM path, and it used to be NARROWED by the branches above it — every
  // non-task command was consumed before reaching it, so `cmd.taskId` typechecked. Delegating
  // does not narrow, so the contract that was implicit becomes explicit: anything that reaches
  // here without a taskId is a command no domain module claimed, which is a bug, not a state.
  if (!isTaskCommand(cmd)) throw new DomainError('INVALID_INPUT', `unhandled command ${(cmd as { type: string }).type}`);

  // Ship gate arming check (docs/23): claiming ship prep is legal only for a
  // repo-backed task with an open PR, in a project whose release gate is on.
  // Both are enforced here — the daemon's own filter is convenience, not law.
  if (cmd.type === 'task.claim_ship') {
    const t = await store.getTask(cmd.taskId);
    if (!t) throw new DomainError('NOT_FOUND', `task ${cmd.taskId} not found`);
    if (!t.prNumber) {
      throw new DomainError('INVALID_INPUT', 'the ship gate covers repo-backed tasks with an open pull request — a human accept ships this one directly');
    }
    if (!(await store.shipGate(cmd.taskId))) {
      throw new DomainError('NOT_PERMITTED', 'the release gate is off for this project — a human accept merges it directly');
    }
  }

  // Subtask gate (docs/24): a parent may not pass submit/accept/ship with open
  // companion work — the count is fetched here, verified structurally inside
  // evaluateTransition (SUBTASKS_PENDING). Zero cost for every other command.
  const subtasksPending = SUBTASK_GATED.has(cmd.type) ? await store.pendingSubtasks(cmd.taskId) : 0;

  // The plan's version comes from the plan artifacts that already exist — fetched here,
  // beside the subtask count, because the reducer is pure and cannot read them. This is
  // the ONE place a plan is named; the daemon reads the assigned name back off the
  // response rather than deriving a second one (see nextPlanVersion).
  const planVersion = cmd.type === 'task.propose_plan'
    ? nextPlanVersion((await store.listArtifacts(cmd.taskId)).map((a) => a.name))
    : 0;

  // ACCEPT ON THE HUMAN'S WORD (George, 2026-09-08: "a user should explicitly tell the model in chat
  // e.g. merge for those actions to happen, not a button click"). The Accept button is gone from
  // every surface; the orchestrator's accept_task carries the human's instruction here. What the
  // server can PROVE is that a person spoke in this task's thread after the review verdict — the
  // reading of the words stays the agent's judgment. Without that evidence the old floor holds.
  const word = cmd.type === 'task.accept' && actor.kind !== 'human' ? await store.latestHumanWord(cmd.taskId) : null;
  if (cmd.type === 'task.accept' && actor.kind !== 'human' && !word) {
    throw new DomainError('HUMAN_ONLY', 'accept needs the human\'s word: no human message in this thread since the review verdict');
  }

  let outcome = await store.mutate(cmd.taskId, async (task) => {
    if (cmd.type === 'task.confirm_requirements') return confirmRequirements(task, actor, cmd.checklist);
    if (cmd.type === 'task.approve_plan') return approvePlan(task, actor);
    if (cmd.type === 'task.set_definition_of_done') return setDefinitionOfDone(task, actor, cmd.dod);
    if (cmd.type === 'task.update_details') return updateDetails(task, actor, cmd);
    if (cmd.type === 'task.select_design_provider') return selectDesignProvider(task, actor, cmd.provider);
    if (cmd.type === 'task.check_ship_item') return checkShipItem(task, actor, cmd);
    if (cmd.type === 'task.add_ship_item') return addShipItem(task, actor, cmd);
    return transition(task, actor, cmd, subtasksPending, planVersion, !!word);
  });
  // the record names the message the accept acted on, so the thread can say "on your word at 11:01"
  if (word) Object.assign(outcome, { onWord: word });
  // Plan + routine follow-ups (2026-08-19): a revised plan posts its ‹plan:vN› card message,
  // and a routine-born unit auto-accepts off review's `done` — both fail-soft, in planfollowup.ts.
  await planRevisionFollowup(store, actor, cmd, outcome);
  outcome = await routineAcceptFollowup(store, cmd, outcome);
  outcome = await routinePlanFollowup(store, cmd, outcome);
  outcome = await routineDesignFollowup(store, cmd, outcome);
  // Beats backstop (docs/17): acceptance is the strongest "the work completed" signal —
  // any beat still pulsing settles done, whatever flow left it (a settle that raced its
  // own phase transition, a crashed run). Enforced here rather than prompted into flows;
  // descriptive only and best-effort, so it never blocks the accept that just committed.
  // `verifying` joins it (docs/23 v2): execute_ship ends all agent work — what remains
  // (merge + release verification) is host machinery, and it must never pulse a beat.
  if (outcome.task.state === 'accepted' || outcome.task.state === 'verifying') {
    await store.settleBeats(outcome.task.id).catch((err) => console.error(`settle_beats ${outcome.task.id} failed:`, err));
  }
  // Plan-first units (2026-08-17): the human's approval MATERIALIZES the plan's proposed
  // subtasks as real rows under the unit — once, on the approval that changed state (a
  // repeated approve returns no events, so a double-click cannot double-mint). Best-effort
  // per row: a failed mint must not undo the approval that just committed, and the panel's
  // add box remains the manual recovery path.
  if (outcome.events.some((e) => e.type === 'task.plan_approved') && outcome.task.workPlan?.subtasks.length) {
    for (const title of outcome.task.workPlan.subtasks) {
      await createTask(store, actor, {
        type: 'task.create',
        workspace: outcome.task.workspace,
        channel: outcome.task.channel,
        title,
        description: '',
        backlog: false,
        parent: outcome.task.id,
      } as Extract<Command, { type: 'task.create' }>).catch((err) => console.error(`plan subtask mint failed for ${outcome.task.id}:`, err));
    }
  }
  return outcome;
}








