// task.create — the ONE path a task reaches the board by, for every actor.
// It is its own file because it is the only command with real construction logic: resolving the
// channel and project, the backlog vs todo split (docs/15), the subtask gate (MAKE_IT_A_SUBTASK),
// and the repo binding. Split out of handler.ts (track C1).
import {
  commRulesFrom,
  scrubEmdash,



  createEvent,
  planArtifactName,
  renderPlanMarkdown,










  taskBranch,
  validateWorkPlanLegs,
  type Actor,
  type WorkPlan,


  type Task,



} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';

import { normalizeTaskTitle, type Store } from '../store';
import { actorAddress, taskTarget } from './guards';
import { postPlanMessage } from './planfollowup';

























import type { CommandOutcome } from '../handler';

export async function createTask(
  store: Store,
  actor: Actor,
  cmd: Extract<Command, { type: 'task.create' }>,
): Promise<CommandOutcome> {
  // any teammate may PARK an idea (backlog:true — docs/15) or spin up companion
  // work UNDER a task (parent: — docs/24); creating live top-level todo work
  // stays human/orchestrator-only. A backlog item can't be born offered:
  // offering rides the promote-then-offer path, and promotion is a
  // human/orchestrator call — so an agent can never route top-level work.
  const mayCreate = actor.kind === 'human' || actor.role === 'orchestrator' || cmd.backlog || !!cmd.parent;
  if (!mayCreate) {
    throw new DomainError('NOT_PERMITTED', 'only humans or the channel orchestrator create tasks (any teammate may add a backlog item or a subtask)');
  }
  // the workspace voice, enforced at the row's birth (docs/design/agent-comm-rules-2026-08
  // slice 3): agent-authored titles/descriptions are scrubbed fence-aware when noEmdash is
  // on. Humans are never rewritten; a failed rules read fails open.
  if (actor.kind === 'agent') {
    const rules = commRulesFrom(await store.getCommRules(cmd.workspace).catch(() => null));
    if (rules.noEmdash) {
      cmd = { ...cmd, title: scrubEmdash(cmd.title), description: scrubEmdash(cmd.description) };
    }
  }
  if (cmd.backlog && cmd.offerTo) {
    throw new DomainError('INVALID_INPUT', 'a backlog item cannot be offered — promote it to todo first');
  }
  if (cmd.backlog && cmd.parent) {
    throw new DomainError('INVALID_INPUT', 'a subtask is live companion work — it cannot be parked in the backlog');
  }
  // docs/34 — the server floor under chat mode. The chat turn is already built from a tool
  // registry with no create_task in it, but a registry is a property of one code path: a stale
  // client, a second daemon, or a future caller could still reach here. This is the stop that
  // does not depend on who is asking. A missing thread is NOT a chat (getThreadMode returns
  // null), so a stale id fails the way it always did rather than becoming a new error class.
  if (cmd.thread && (await store.getThreadMode(cmd.workspace, cmd.thread)) === 'chat') {
    throw new DomainError('CHAT_THREAD', 'this conversation has Tasks turned off — turn it on in the thread\'s composer, then ask again');
  }
  if (cmd.originThread && (await store.getThreadMode(cmd.workspace, cmd.originThread)) === 'chat') {
    throw new DomainError('CHAT_THREAD', 'this conversation has Tasks turned off — a chat thread cannot own board work');
  }
  // ── Plan-first units (2026-08-17) ──
  // A create carrying `plan` is born in plan_review with its work plan attached: the declared
  // journey + proposed subtasks the HUMAN reviews in the unit's thread before any work starts
  // (approve_plan, already human-only). Backlog parks and subtasks ignore it — a parked idea
  // has no journey yet, and a subtask rides its parent's gates.
  const workPlanInput = !cmd.backlog && !cmd.parent && cmd.plan ? cmd.plan : null;
  if (workPlanInput) {
    const bad = validateWorkPlanLegs(workPlanInput.legs, !!cmd.repo);
    if (bad) throw new DomainError('INVALID_INPUT', bad);
  }
  // ── Routines are hands-off (2026-08-19, founder report) ──
  // A task born from a routine's thread (threads.schedule_id, 0119) runs with NO human in the
  // loop: its plan is born APPROVED (same fields approve_plan stamps, so the claim guard and
  // route watch see an ordinary approved unit), its subtasks mint at create, and when review
  // lands it `done` the server auto-accepts and pushes "routine finished" — the human opens the
  // thread to READ the run, never to unblock it. Scoped to repo-less work: a repo-backed task
  // merges code on accept, and that stays a human's signature whatever opened the thread.
  const routineScheduleId = workPlanInput && cmd.originThread
    ? await store.getThreadScheduleId(cmd.workspace, cmd.originThread)
    : null;
  const routine = !!routineScheduleId && !cmd.repo;
  // ── Playbook runs are hands-off too (2026-08-21, founder review of the live pass) ──
  // A playbook's "plan" is the registry's canned template, selected by the human's own ask —
  // demanding approve_plan on it was ceremony, and the live run showed exactly that: five
  // units parked at gates whose plans nobody needed to read. Same stamps as a routine, same
  // repo floor: code merges on a human whatever created the unit.
  const playbookRun = !!cmd.playbook && !cmd.repo && !!workPlanInput;
  const handsOff = routine || playbookRun;
  // offering at creation IS routing — the task must be categorized (docs/16). A bare
  // todo or a parked backlog item may omit kind; an offered one may not. Never a
  // route gate: any kind is accepted here, we only require that one is set.
  // Subtasks are exempt: minor companion work inherits its parent's context.
  if (cmd.offerTo && !cmd.kind && !cmd.parent) {
    throw new DomainError('INVALID_INPUT', 'offering a task at creation requires a kind (bug/feature/…) — categorize it');
  }

  // Subtask validation (docs/24) — structurally minor, by construction:
  // one level deep, ≤8 live per parent, same channel, no repo of its own
  // (it rides the parent's), and only under an ACTIVE parent.
  let parent: Task | null = null;
  if (cmd.parent) {
    parent = await store.getTask(cmd.parent);
    if (!parent) throw new DomainError('NOT_FOUND', `parent task ${cmd.parent} not found`);
    if (parent.parentTaskId) throw new DomainError('INVALID_INPUT', `#${parent.number} is itself a subtask — subtasks nest one level, hang this off its parent`);
    if (parent.state === 'backlog' || parent.state === 'accepted' || parent.state === 'closed') {
      throw new DomainError('INVALID_INPUT', `#${parent.number} is ${parent.state} — subtasks ride an active task`);
    }
    if (parent.workspace !== cmd.workspace) {
      throw new DomainError('INVALID_INPUT', 'a subtask lives in its parent\'s workspace');
    }
    if (cmd.repo) throw new DomainError('INVALID_INPUT', 'a subtask has no repo of its own — it rides the parent\'s branch and thread');
    const live = await store.subtaskCount(parent.id);
    if (live >= 8) throw new DomainError('INVALID_INPUT', `#${parent.number} already has ${live} subtasks — the cap is 8; finish or cancel some first`);
  }

  // The shadow-task bounce (docs/24, the #1018 class): an AGENT creating a peer
  // task whose title/description names an open task in this channel is creating
  // companion work — it must ride that task as a subtask, never clutter the board
  // as a sibling. Humans bypass (a deliberate cross-reference is their call);
  // backlog parks stay frictionless (parked ideas cite tasks all the time).
  if (actor.kind === 'agent' && !cmd.backlog && !cmd.parent) {
    const referenced = [...`${cmd.title} ${cmd.description}`.matchAll(/#(\d{3,5})\b/g)].map((m) => Number(m[1]));
    for (const n of [...new Set(referenced)].slice(0, 5)) {
      const open = await store.getTaskByNumber(cmd.workspace, cmd.channel, n);
      if (open && open.state !== 'accepted' && open.state !== 'closed' && open.state !== 'backlog') {
        throw new DomainError(
          'MAKE_IT_A_SUBTASK',
          `this names open task #${n} in the same channel — companion work rides the task: re-create it with parent "${open.id}" (add_subtask), or drop the reference if it is genuinely unrelated work`,
        );
      }
    }
  }

  // Enforced duplicate guard (the #1015/#1016 double-triage): two orchestrator turns
  // racing one request must not BOTH create it. An agent creating live work is refused
  // when an open non-backlog task in this channel already carries the same normalized
  // title, at any age — the 409 names the survivor so the refused
  // turn routes or acts on it instead. Humans bypass (they resolve duplicates in the
  // UI, and a deliberate same-title re-create is their call); backlog parks stay
  // frictionless (prompt-checked via list_backlog, and parked ideas gate nothing).
  if (actor.kind === 'agent' && !cmd.backlog) {
    const dup = await store.recentDuplicateTask(cmd.workspace, cmd.channel, normalizeTaskTitle(cmd.title), null);
    if (dup) {
      throw new DomainError(
        'DUPLICATE_TASK',
        `an open task with this title already exists in this channel: #${dup.number} “${dup.title}” — do not create another; route or act on #${dup.number} instead (or retitle if this is genuinely different work)`,
      );
    }
  }

  // Plan-first is the law for AGENT creates (2026-08-17, George: the proposal card retired —
  // "one less blocking point"). The orchestrator creates directly now, so the floor lives
  // here, BELOW the shadow-task and duplicate guards — their errors carry the fix (make it a
  // subtask / act on #N), and the generic floor must not mask them: a live top-level agent create MUST carry its implementation plan — the unit is born
  // in plan_review, inert until the human approves. Humans keep the plain create (the board's
  // + New task); backlog parks and subtasks are exempt as ever.
  if (actor.kind === 'agent' && !cmd.backlog && !cmd.parent && !workPlanInput) {
    throw new DomainError('INVALID_INPUT', 'PLAN_FIRST: a live task starts with its implementation plan — pass plan:{legs, subtasks, approach} so the human reviews it in the unit\'s thread before work begins');
  }

  const offeredAgentId = cmd.offerTo ? await store.resolveOffer(cmd.workspace, cmd.channel, cmd.offerTo) : null;
  const number = await store.nextTaskNumber(cmd.workspace);
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    workspace: cmd.workspace,
    // a subtask lives in its parent's channel BY CONSTRUCTION — inherited, not
    // validated (callers pass channel ids or slugs; the parent's slug is truth)
    channel: parent ? parent.channel : cmd.channel,
    project: parent ? parent.project : (cmd.project ?? null),
    number,
    title: cmd.title,
    description: cmd.description,
    state: cmd.backlog ? 'backlog' : workPlanInput ? 'plan_review' : 'todo',
    kind: cmd.kind ?? null,
    creator: { kind: actor.kind, id: actor.id },
    assignee: null,
    offeredAgentId,
    requirements: cmd.checklist ?? null,
    definitionOfDone: cmd.definitionOfDone ?? '',
    repo: cmd.repo ? { id: cmd.repo.id, baseRef: cmd.repo.baseRef, branch: taskBranch(number, cmd.title) } : null,
    submittedSha: null,
    prUrl: '',
    prNumber: null,
    artifactCount: 0,
    blockedFrom: null,
    // a checklist at creation means the creator resolved requirements —
    // the offered worker executes them instead of self-confirming. Subtasks
    // skip the intake ritual entirely (minor companion work, docs/24). A
    // routine-born unit is born past both gates (see `routine` above).
    requirementsConfirmed: !!cmd.checklist?.length || !!parent || handsOff,
    planApprovedAt: handsOff ? now : null,
    workPlan: workPlanInput
      ? ({ legs: workPlanInput.legs, subtasks: workPlanInput.subtasks ?? [], approach: workPlanInput.approach, version: 1, proposedAt: now } satisfies WorkPlan)
      : null,
    originThreadId: cmd.originThread ?? null,
    shipPlan: null,
    parentTaskId: parent?.id ?? null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };

  const event = createEvent({
    type: 'task.created',
    source: actorAddress(actor),
    target: taskTarget(task),
    workspace: task.workspace,
    payload: { title: task.title, channel: task.channel, project: task.project, repo: task.repo, offeredTo: cmd.offerTo ?? null, ...(task.kind ? { kind: task.kind } : {}), ...(cmd.backlog ? { backlog: true } : {}), ...(parent ? { parent: parent.id, parentNumber: parent.number } : {}), ...(task.workPlan ? { planFirst: true, legs: task.workPlan.legs } : {}), ...(task.originThreadId ? { originThread: task.originThreadId } : {}), ...(routine ? { routine: true, scheduleId: routineScheduleId } : {}), ...(playbookRun ? { playbook: cmd.playbook } : {}) },
  });

  await store.createTask(task, event);
  // conversation-first shell: link the thread this task was fanned out OF, so the chat
  // thread upgrades into the task's thread in place. Link-if-unlinked; never fatal —
  // the task is real either way, and a raced/stale thread id must not undo creation.
  if (cmd.thread) await store.linkThreadTask(cmd.workspace, cmd.thread, task.id).catch(() => {});
  // Thread-owned work (2026-08-17): the unit card — a real synced message in the OWNING
  // conversation carrying the ‹task:id› marker both thread renderers swap for the live card.
  // The card is a lens on the task row, never a copy; the message is the durable record that
  // this conversation caused the work. Fail-soft for the same reason as linkThreadTask.
  if (cmd.originThread) {
    await store
      .postMessage(
        {
          id: crypto.randomUUID(),
          workspace: task.workspace,
          channel: task.channel,
          taskId: null,
          threadId: cmd.originThread,
          author: { kind: actor.kind, id: actor.id },
          body: `\u2039task:${task.id}\u203a`,
          createdAt: new Date().toISOString(),
        },
        createEvent({
          type: 'message.posted',
          source: actorAddress(actor),
          target: taskTarget(task),
          workspace: task.workspace,
          payload: { preview: `unit card #${task.number}`, unitCard: true },
        }),
      )
      .catch(() => {});
  }
  // ── The plan is a DOCUMENT (2026-08-19, founder report) ──
  // The birth plan gets what every REVISION already had (propose_plan materializes
  // implementation-plan-vN.md): a versioned doc artifact plus a normal thread message naming it,
  // so the thread shows a card, the name linkifies into the full-tab review overlay, and the
  // human reviews a real markdown plan — not a jsonb blob rendered into a gate card. Fail-soft
  // like the unit card: the task is real even if the materialization races.
  if (task.workPlan) {
    const planName = planArtifactName(1);
    await store
      .mutate(task.id, async (t) => ({
        task: t,
        events: [],
        artifacts: [{
          kind: 'doc',
          name: planName,
          content: renderPlanMarkdown({ number: task.number, title: task.title, kind: task.kind, legs: task.workPlan!.legs, subtasks: task.workPlan!.subtasks, approach: task.workPlan!.approach, version: 1 }),
        }],
      }))
      .catch(() => {});
    await postPlanMessage(store, task, actor, 1, routine
      ? `⏱ Routine run — implementation plan **v1** (${planName}). Work starts now, hands-off; you'll be notified when it's done.`
      : playbookRun
        ? `▶ Playbook run — plan **v1** (${planName}), the registry's template. Work starts now; your gate is accepting the deliverable.`
        : `Implementation plan **v1** — ${planName}`);
  }
  // a hands-off unit's proposed subtasks mint at CREATE — approval never comes, and the run
  // needs them (routines since 2026-08-19; playbook runs since round 3 — `routine` alone here
  // left a playbook's declared legs permanently unminted)
  if (handsOff && task.workPlan?.subtasks.length) {
    for (const title of task.workPlan.subtasks) {
      await createTask(store, actor, {
        type: 'task.create',
        workspace: task.workspace,
        channel: task.channel,
        title,
        description: '',
        backlog: false,
        parent: task.id,
      } as Extract<Command, { type: 'task.create' }>).catch(() => {});
    }
  }
  return { task, events: [event] };
}
