export const TASK_STATES = [
  'backlog',
  'todo',
  'designing',
  'design_review',
  'planning',
  'plan_review',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'shipping',
  'ship_review',
  'releasing',
  'verifying',
  'accepted',
  'closed',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

// Work-type taxonomy (docs/16). A descriptive label the orchestrator sets at
// triage — the ONE source of truth for the enum, mirrored by the SQL enum in
// supabase/migrations/0057_task_kind.sql, the zod schema (control-api commands),
// the orchestrator tools, and the board chip. `kind` is a LABEL + routing prior,
// never a gate: the enforcement layer lets any kind take any route — whether a
// task needs design/plan/direct is the orchestrator's per-request judgment, not
// a function of its kind (docs/16 §5). Append-only: new kinds go at the end.
export const TASK_KINDS = ['bug', 'feature', 'refactor', 'chore', 'docs', 'research', 'spike', 'design', 'content', 'setup'] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export type ActorKind = 'human' | 'agent';
export const AGENT_ROLES = ['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator', 'shipper', 'marketer'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface Actor {
  kind: ActorKind;
  id: string;
  role?: AgentRole;
}

export type TransitionName =
  | 'claim'
  | 'cancel'
  | 'block'
  | 'unblock'
  | 'submit'
  | 'request_changes'
  | 'approve'
  | 'accept'
  | 'archive'
  | 'request_plan'
  | 'propose_plan'
  | 'revise_plan'
  | 'request_design'
  | 'propose_design'
  | 'revise_design'
  | 'approve_design'
  | 'claim_ship'
  | 'propose_ship_plan'
  | 'revise_ship_plan'
  | 'approve_ship_plan'
  | 'execute_ship'
  | 'confirm_release'
  | 'finish'
  | 'promote'
  | 'reopen';

export type TransitionParty = 'assignee' | 'reviewer' | 'human' | 'orchestrator' | 'creator' | 'architect' | 'designer' | 'shipper';

export interface TransitionSpec {
  readonly name: TransitionName;
  readonly from: TaskState;
  readonly to: TaskState;
  readonly by: readonly TransitionParty[];
}

// The single source of truth for the board lifecycle (docs/03 §2). The SQL
// trigger in supabase/migrations mirrors these pairs as defense-in-depth.
export const TRANSITIONS: readonly TransitionSpec[] = [
  // Backlog — the parking lot BEFORE todo (docs/15). Any teammate may park an
  // idea there (task.create backlog:true is the one creation path open to every
  // actor), but releasing it into todo is a deliberate human/orchestrator call.
  // There are deliberately NO other edges out of backlog: a parked item cannot
  // be offered, claimed, designed, planned, or blocked — an agent can never
  // start work on one until someone promotes it.
  { name: 'promote', from: 'backlog', to: 'todo', by: ['orchestrator', 'human'] },
  { name: 'cancel', from: 'backlog', to: 'closed', by: ['orchestrator', 'human', 'creator'] },
  { name: 'claim', from: 'todo', to: 'in_progress', by: ['assignee'] },
  { name: 'cancel', from: 'todo', to: 'closed', by: ['orchestrator', 'human', 'creator'] },
  // Design lifecycle — a visual-quality gate BEFORE planning (docs/14). The
  // orchestrator (or a human) routes user-facing work into designing; the channel
  // designer proposes mockups; approval is a HUMAN sign-off (no auto-approve —
  // a design is taste) and releases the task into planning for the architect.
  // There is deliberately NO designing -> in_progress edge: nothing gets built
  // from an unapproved design.
  { name: 'request_design', from: 'todo', to: 'designing', by: ['orchestrator', 'human'] },
  // The ORCHESTRATOR may propose too, and must be able to (docs/29 §4d). Rex owns the WHOLE flow
  // including design — it brings a designer IN (a subagent seated on the channel designer's config,
  // so the specialty and model are inherited) rather than handing the task over. A design round is
  // a phase of the parent process, not a separate delegated task, and a subagent has no `agents`
  // row and no board identity (docs/harness/04 I2) — so if only a seated designer could propose,
  // an owned design round could never reach the human gate at all. The owner proposes what its
  // subtree drew; the HUMAN still approves it, which is the part that matters.
  { name: 'propose_design', from: 'designing', to: 'design_review', by: ['designer', 'orchestrator'] },
  { name: 'revise_design', from: 'design_review', to: 'designing', by: ['orchestrator', 'human'] },
  { name: 'approve_design', from: 'design_review', to: 'planning', by: ['human'] },
  { name: 'cancel', from: 'designing', to: 'closed', by: ['orchestrator', 'human'] },
  { name: 'cancel', from: 'design_review', to: 'closed', by: ['orchestrator', 'human'] },
  // Plan lifecycle — an implementation-quality gate before execution. The
  // orchestrator routes a non-trivial task into planning; the architect (the
  // assignee while planning) proposes a plan; once approved it's offered to a
  // developer who claims from plan_review. There is deliberately NO
  // planning -> in_progress edge: a dev cannot start while the plan is unsettled.
  { name: 'request_plan', from: 'todo', to: 'planning', by: ['orchestrator', 'human'] },
  // Same reason as propose_design: under ownership the plan is drafted by an architect SUBAGENT
  // with no board identity, and the owner is the one that answers for it.
  { name: 'propose_plan', from: 'planning', to: 'plan_review', by: ['architect', 'orchestrator'] },
  { name: 'revise_plan', from: 'plan_review', to: 'planning', by: ['orchestrator', 'human'] },
  { name: 'claim', from: 'plan_review', to: 'in_progress', by: ['assignee'] },
  // Plan-first units (2026-08-17): a unit born WITH its work plan sits in plan_review from
  // birth, and once the HUMAN approves, the declared legs route it — a design-first journey
  // leaves plan_review toward designing (this edge, refused until planApproved exactly like
  // the claim above), a build-first one is offered and claims out on the edge above. After an
  // approved design round, a plan-first unit returns to `todo` for its build offer instead of
  // re-entering planning — its plan already exists (the approve_design fork; the handler picks
  // the target by task.workPlan, the way unblock picks its return state).
  { name: 'request_design', from: 'plan_review', to: 'designing', by: ['orchestrator', 'human'] },
  { name: 'approve_design', from: 'design_review', to: 'todo', by: ['human'] },
  { name: 'cancel', from: 'planning', to: 'closed', by: ['orchestrator', 'human'] },
  { name: 'cancel', from: 'plan_review', to: 'closed', by: ['orchestrator', 'human'] },
  // Block is legal from EVERY working stage — a stage agent hitting a wall
  // (auth down, generation failed, evidence missing) surfaces it as `blocked`
  // instead of stranding the task in a state nothing retries. `unblock` returns
  // the task to the stage it was blocked FROM (tasks.blocked_from, stamped by
  // the server at block time) — never blindly to in_progress.
  // The OWNER opens a phase from in_progress (docs/29 §4d). Under ownership rex CLAIMS the task
  // first and only then decides which phase it needs — so `request_design` existing only from
  // `todo` meant taking a task made its own design phase unreachable. The board could describe an
  // owned design round; nothing could get into one.
  //
  // Orchestrator and human only, deliberately: a worker deciding mid-build that it wants a design
  // round is scope creep with a transition, and it should block back instead.
  { name: 'request_design', from: 'in_progress', to: 'designing', by: ['orchestrator', 'human'] },
  { name: 'request_plan', from: 'in_progress', to: 'planning', by: ['orchestrator', 'human'] },
  { name: 'block', from: 'in_progress', to: 'blocked', by: ['assignee', 'orchestrator', 'human'] },
  { name: 'block', from: 'planning', to: 'blocked', by: ['assignee', 'architect', 'orchestrator', 'human'] },
  { name: 'block', from: 'designing', to: 'blocked', by: ['assignee', 'designer', 'orchestrator', 'human'] },
  { name: 'block', from: 'in_review', to: 'blocked', by: ['reviewer', 'orchestrator', 'human'] },
  { name: 'unblock', from: 'blocked', to: 'in_progress', by: ['assignee', 'orchestrator', 'human'] },
  { name: 'unblock', from: 'blocked', to: 'planning', by: ['assignee', 'orchestrator', 'human'] },
  { name: 'unblock', from: 'blocked', to: 'designing', by: ['assignee', 'orchestrator', 'human'] },
  { name: 'unblock', from: 'blocked', to: 'in_review', by: ['assignee', 'orchestrator', 'human'] },
  // stop an actively-running task outright — the human (or orchestrator on their
  // behalf) halts a wrong/runaway agent without waiting for it to submit; the
  // host aborts the in-flight run when the task lands in `closed`. The assignee
  // can't self-stop (use block to pause), keeping the halt a deliberate call.
  { name: 'cancel', from: 'in_progress', to: 'closed', by: ['orchestrator', 'human'] },
  { name: 'cancel', from: 'blocked', to: 'closed', by: ['orchestrator', 'human'] },
  { name: 'submit', from: 'in_progress', to: 'in_review', by: ['assignee'] },
  // the reviewer's verdict, the human's, or the orchestrator relaying the human ("send it back to
  // plume") — the same coordinator that may bounce a `done` task (below), a stalled review (docs/19),
  // or a marketing draft in review. The assignee can't request_changes on its own work (self-review
  // guard), so this never lets a worker re-open its own task.
  { name: 'request_changes', from: 'in_review', to: 'in_progress', by: ['reviewer', 'human', 'orchestrator'] },
  // an approved (done) task isn't final until a human accepts it — the human (or
  // the orchestrator on their behalf) can still bounce it back to the dev if the
  // reviewer missed something or requirements weren't actually met
  { name: 'request_changes', from: 'done', to: 'in_progress', by: ['human', 'orchestrator'] },
  // humans may kill unaccepted work outright — review isn't a one-way ratchet
  { name: 'cancel', from: 'in_review', to: 'closed', by: ['human'] },
  { name: 'cancel', from: 'done', to: 'closed', by: ['human'] },
  { name: 'approve', from: 'in_review', to: 'done', by: ['reviewer', 'human'] },
  { name: 'accept', from: 'done', to: 'accepted', by: ['human'] },
  // Ship lifecycle — the release gate BETWEEN review-approve and merge (docs/23).
  // In a ship-gated project the channel shipper claims a reviewer-approved,
  // repo-backed task, studies the change, and proposes a production-readiness
  // plan (report + owner-tagged checklist). Approving that plan is a HUMAN
  // sign-off (like accept/approve_design); once approved, owners tick their
  // items and execute_ship — the shipper's merge — is refused by the server
  // until every item is checked (SHIP_ITEMS_PENDING). The direct human accept
  // stays legal from every ship state: the gate is a paved road, never a cage.
  { name: 'claim_ship', from: 'done', to: 'shipping', by: ['shipper'] },
  { name: 'propose_ship_plan', from: 'shipping', to: 'ship_review', by: ['shipper'] },
  { name: 'revise_ship_plan', from: 'ship_review', to: 'shipping', by: ['orchestrator', 'human'] },
  // …and again while the shipper is already redrafting: a human who reads the
  // bounced plan and adds a second round of notes must not hit a wall. The
  // self-loop stamps fresh feedback (ship_plan.revisionRequestedAt) and the
  // shipper re-enters the draft flow — without it, `shipping` swallowed every
  // later change request (409) and the task parked forever.
  { name: 'revise_ship_plan', from: 'shipping', to: 'shipping', by: ['orchestrator', 'human'] },
  { name: 'approve_ship_plan', from: 'ship_review', to: 'releasing', by: ['human'] },
  // execute_ship lands in `verifying`, NOT accepted: the host merges the PR
  // there and watches the release land (post-merge CI on the merge commit,
  // release workflows) — only a green verdict earns confirm_release. Accepted
  // now MEANS "merged and the release verified", not "merge scheduled".
  { name: 'execute_ship', from: 'releasing', to: 'verifying', by: ['shipper'] },
  { name: 'confirm_release', from: 'verifying', to: 'accepted', by: ['shipper'] },
  // the escape hatch this comment has always promised, now true of `shipping`
  // too — the shipper's drafting stage was the one ship state a human could not
  // accept out of, which turned a quiet shipper into a dead end
  { name: 'accept', from: 'shipping', to: 'accepted', by: ['human'] },
  { name: 'accept', from: 'ship_review', to: 'accepted', by: ['human'] },
  { name: 'accept', from: 'releasing', to: 'accepted', by: ['human'] },
  // the escape hatch survives verification too — a human may accept over a red
  // or still-pending verdict (their call, recorded in the events log)
  { name: 'accept', from: 'verifying', to: 'accepted', by: ['human'] },
  // late-found problems bounce to the developer exactly like a done-state bounce
  // — including from the drafting stage, where the fix belongs to the developer
  // rather than the release plan
  { name: 'request_changes', from: 'shipping', to: 'in_progress', by: ['human', 'orchestrator'] },
  { name: 'request_changes', from: 'ship_review', to: 'in_progress', by: ['human', 'orchestrator'] },
  { name: 'request_changes', from: 'releasing', to: 'in_progress', by: ['human', 'orchestrator'] },
  // a failed release verification bounces for a fix-forward round (the PR is
  // already merged — the next submit carries a fresh branch + PR)
  { name: 'request_changes', from: 'verifying', to: 'in_progress', by: ['human', 'orchestrator'] },
  { name: 'cancel', from: 'shipping', to: 'closed', by: ['human'] },
  { name: 'cancel', from: 'ship_review', to: 'closed', by: ['human'] },
  { name: 'cancel', from: 'releasing', to: 'closed', by: ['human'] },
  { name: 'cancel', from: 'verifying', to: 'closed', by: ['human'] },
  // the shipper's active drafting stage is blockable like every working stage
  { name: 'block', from: 'shipping', to: 'blocked', by: ['shipper', 'orchestrator', 'human'] },
  { name: 'unblock', from: 'blocked', to: 'shipping', by: ['shipper', 'orchestrator', 'human'] },
  // Subtasks (docs/24): companion work under a parent task. A subtask row's whole
  // life is claim → finish (its parent's gates cover review/ship for the sum);
  // `finish` exists ONLY for subtasks — evaluateTransition rejects it for parents
  // — and a human may finish one straight from todo (the boss check-off: no
  // subtask can become a blocker; cancel is the other relief valve).
  { name: 'finish', from: 'in_progress', to: 'done', by: ['assignee', 'human'] },
  { name: 'finish', from: 'todo', to: 'done', by: ['human'] },
  { name: 'archive', from: 'accepted', to: 'closed', by: ['human', 'orchestrator'] },

  // REOPEN — the one edge out of `closed` (2026-08-11, George: a closed task's reply field is
  // disabled, and reopening is how you get it back). Closed was terminal by construction, which
  // was right about agents and wrong about people: a task cancelled by mistake, or one whose
  // reason came back a week later, had no route home but a fresh task that loses the thread.
  //
  // HUMAN ONLY, and deliberately narrower than cancel's actor list: an agent that could reopen
  // its own cancelled work would make "closed" a suggestion. It lands in `todo` — the state the
  // board triages from — never back in the middle of a phase whose run and worktree are gone
  // (the host aborts those on close, so `in_progress` would be a state with no work behind it).
  { name: 'reopen', from: 'closed', to: 'todo', by: ['human'] },
];

// The only moves a subtask row may make — everything else (design/plan/review/
// ship/offer-into-review ceremonies) belongs to the PARENT. Enforced in
// evaluateTransition via ctx.isSubtask; the SQL trigger stays the pair check.
export const SUBTASK_TRANSITIONS: ReadonlySet<TransitionName> = new Set(['claim', 'finish', 'cancel']);

// A SETUP task (kind='setup', docs setup-flows round 2026-08-09) is a guided checklist the
// HUMAN walks, not work an agent performs — so its whole life is even leaner than a subtask's:
// finish (the wizard's last step) or cancel (the opt-out valve). No claim: nothing is assigned,
// because there is nothing to execute — the thread exists so an abandoned setup stays findable,
// resumable and countable instead of evaporating with the card that offered it. Rides edges the
// subtask round already made SQL-legal (todo→done); by construction no agent can offer, claim,
// design, plan, block or review one.
export const SETUP_TASK_TRANSITIONS: ReadonlySet<TransitionName> = new Set(['finish', 'cancel']);

// Resolve a spec by edge — and by NAME when the caller knows its intent. Two
// intents may legally share an edge (releasing -> accepted is the shipper's
// guarded execute_ship AND the human's escape-hatch accept); without the name
// the first spec would shadow the second. Name omitted = first edge match
// (back-compat for pure legality checks like canTransition).
export function findTransition(from: TaskState, to: TaskState, name?: TransitionName): TransitionSpec | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && (name === undefined || t.name === name));
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return findTransition(from, to) !== undefined;
}

export function legalTargets(from: TaskState): TaskState[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

export type TransitionErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'NOT_PERMITTED'
  | 'EVIDENCE_REQUIRED'
  | 'PUSH_REQUIRED'
  | 'SELF_REVIEW_BLOCKED'
  | 'HUMAN_ONLY'
  | 'PLAN_NOT_APPROVED'
  | 'SHIP_ITEMS_PENDING'
  | 'SUBTASKS_PENDING';

export interface TransitionContext {
  actor: Actor;
  // For 'claim', the caller sets isAssignee=true when the actor is an eligible
  // claimer (unassigned task, or the task was offered to this actor).
  isAssignee: boolean;
  isCreator: boolean;
  isReviewerPoolMember: boolean;
  artifactCount: number;
  repoBacked: boolean;
  pushedSha: string | null;
  // Ship gate (docs/23): whether the task's release plan is human-approved, and
  // how many checklist items are still unchecked (not done/na). Both are
  // properties of the work — execute_ship is structurally refused while any
  // item is pending, so an early merge is impossible, not discouraged.
  shipPlanApproved: boolean;
  shipItemsPending: number;
  // Plan gate (docs/29 §4d): whether the implementation plan is human-approved. Same shape as
  // shipPlanApproved and for the same reason — before this, "the human approved the plan" was
  // PROMPT ETIQUETTE: `plan_review -> in_progress` was a plain claim, so an agent could start
  // building an unapproved plan and nothing structural said no. Doctrine §4 wants it impossible.
  planApproved: boolean;
  /**
   * Plan-first units (2026-08-17): true when the task's approved work plan omits the review
   * leg — a lean unit (research/scratch, never repo-backed: validateWorkPlanLegs floors that)
   * whose road to the accept gate is `finish`, exactly like a subtask's. Optional so existing
   * context builders stay correct: absent reads as false.
   */
  leanUnit?: boolean;
  // Subtasks (docs/24): is THIS row a subtask (parent_task_id set), and how many
  // of the task's own subtasks are still open (not done/closed). A parent can't
  // pass submit/accept/approve_ship_plan/execute_ship with open subtasks.
  isSubtask: boolean;
  subtasksPending: number;
  // Setup flows: is THIS row a setup task (kind='setup') — the human-walked
  // checklist whose only moves are finish/cancel (SETUP_TASK_TRANSITIONS).
  isSetup: boolean;
  /**
   * Accept on the human's word (2026-09-08). The Accept button left every surface: a done task is
   * accepted when the human SAYS so in its thread ("merge it") and the orchestrator applies it. The
   * handler sets this only after the store proved a human message newer than the review verdict
   * exists in that thread — the agent judges what the words meant, the server holds the evidence.
   * Without it an agent accept stays HUMAN_ONLY, exactly as before.
   */
  onHumanWord?: boolean;
}

export type TransitionVerdict =
  | { ok: true; spec: TransitionSpec }
  | { ok: false; code: TransitionErrorCode; reason: string };

export function evaluateTransition(
  from: TaskState,
  to: TaskState,
  ctx: TransitionContext,
  name?: TransitionName,
): TransitionVerdict {
  const spec = findTransition(from, to, name);
  if (!spec) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: `${from} -> ${to}${name ? ` (${name})` : ''} is not a legal transition`,
    };
  }

  // Structural guards are properties of the work, not the actor.
  if (spec.name === 'submit') {
    if (ctx.artifactCount < 1) {
      return { ok: false, code: 'EVIDENCE_REQUIRED', reason: 'submit requires at least one artifact' };
    }
    if (ctx.repoBacked && !ctx.pushedSha) {
      return {
        ok: false,
        code: 'PUSH_REQUIRED',
        reason: 'repo-backed tasks must push the task branch before review',
      };
    }
  }

  if ((spec.name === 'approve' || spec.name === 'request_changes') && ctx.isAssignee) {
    return { ok: false, code: 'SELF_REVIEW_BLOCKED', reason: 'cannot review your own submission' };
  }

  if (spec.name === 'accept' && ctx.actor.kind !== 'human' && !ctx.onHumanWord) {
    return { ok: false, code: 'HUMAN_ONLY', reason: 'done -> accepted is a human sign-off: the human says merge or accept in the thread, and the orchestrator applies it' };
  }

  // a design is taste — unlike plans (orchestrator may auto-approve), approval
  // of mockups is reserved for the human, with no auto path by construction
  if (spec.name === 'approve_design' && ctx.actor.kind !== 'human') {
    return { ok: false, code: 'HUMAN_ONLY', reason: 'design approval is a human sign-off' };
  }

  // a release plan is accountability — approving what ships to prod is reserved
  // for the human, exactly like accept and approve_design (docs/23)
  if (spec.name === 'approve_ship_plan' && ctx.actor.kind !== 'human') {
    return { ok: false, code: 'HUMAN_ONLY', reason: 'release-plan approval is a human sign-off' };
  }

  // reopening a closed task is a REVERSAL of a decision somebody made (2026-08-11). The `by`
  // list alone would refuse an agent with NOT_PERMITTED — "you are the wrong actor for this
  // transition" — which is the wrong sentence: no agent is ever the right one, and a client
  // reading NOT_PERMITTED reasonably offers to find an actor who qualifies. Same class as
  // accept / approve_design / approve_ship_plan, so it says the same thing.
  if (spec.name === 'reopen' && ctx.actor.kind !== 'human') {
    return { ok: false, code: 'HUMAN_ONLY', reason: 'reopening a closed task is a human decision' };
  }

  // Subtasks (docs/24) are structurally minor: a subtask row may only claim /
  // finish / cancel — the parent's gates cover everything else — and `finish`
  // exists ONLY for subtasks (a parent reaches done through review, never a shortcut).
  if (ctx.isSubtask && !SUBTASK_TRANSITIONS.has(spec.name)) {
    return { ok: false, code: 'NOT_PERMITTED', reason: `a subtask has no ${spec.name} — its parent's gates cover that` };
  }
  // A setup task is a human checklist — nothing about it can be offered, claimed, designed,
  // planned, blocked or reviewed, by construction rather than by prompt (doctrine §4).
  if (ctx.isSetup && !SETUP_TASK_TRANSITIONS.has(spec.name)) {
    return { ok: false, code: 'NOT_PERMITTED', reason: `a setup task has no ${spec.name} — it is finished by completing its steps, or cancelled` };
  }
  if (!ctx.isSubtask && !ctx.isSetup && !ctx.leanUnit && spec.name === 'finish') {
    return { ok: false, code: 'NOT_PERMITTED', reason: 'finish is a subtask move — a task whose plan declares review reaches done through it' };
  }

  // "part of delivering the task" has teeth: a parent may not pass its next gate
  // while companion work is still open. Humans finish or cancel a stale subtask
  // any time — the relief valve that keeps this from ever deadlocking.
  if ((spec.name === 'submit' || spec.name === 'accept' || spec.name === 'approve_ship_plan' || spec.name === 'execute_ship' || spec.name === 'confirm_release') && ctx.subtasksPending > 0) {
    return {
      ok: false,
      code: 'SUBTASKS_PENDING',
      reason: `${ctx.subtasksPending} subtask(s) still open — finish or cancel them first`,
    };
  }

  // Nothing is BUILT from an unapproved plan — the exact counterpart of "nothing is built from an
  // unapproved design", which the FSM has always enforced by having no designing -> in_progress
  // edge. The plan gate could not be expressed that way: `plan_review -> in_progress` is the
  // claim a developer (or the owner) makes, and it is legal — it is only legal AFTER a human signs
  // the plan off. So the gate is a precondition on the edge rather than the absence of one.
  if (spec.from === 'plan_review' && (spec.to === 'in_progress' || spec.to === 'designing') && !ctx.planApproved) {
    return { ok: false, code: 'PLAN_NOT_APPROVED', reason: 'the implementation plan has not been approved by a human' };
  }

  // the shipper's merge is earned, not assumed: every checklist item checked (or
  // n/a) under a human-approved plan, verified structurally — nothing ships early
  if (spec.name === 'execute_ship') {
    if (!ctx.shipPlanApproved) {
      return { ok: false, code: 'SHIP_ITEMS_PENDING', reason: 'the release plan has not been approved by a human' };
    }
    if (ctx.shipItemsPending > 0) {
      return {
        ok: false,
        code: 'SHIP_ITEMS_PENDING',
        reason: `${ctx.shipItemsPending} release checklist item(s) still unchecked — the ship fires when the list clears`,
      };
    }
  }

  const permitted = spec.by.some((party) => {
    switch (party) {
      case 'assignee':
        return ctx.isAssignee;
      case 'creator':
        return ctx.isCreator;
      case 'human':
        // an accept on the human's proven word counts as the human's (the handler verified it)
        return ctx.actor.kind === 'human' || (spec.name === 'accept' && !!ctx.onHumanWord);
      case 'orchestrator':
        return ctx.actor.kind === 'agent' && ctx.actor.role === 'orchestrator';
      case 'reviewer':
        return ctx.actor.kind === 'agent' && ctx.actor.role === 'reviewer' && ctx.isReviewerPoolMember;
      case 'architect':
        return ctx.actor.kind === 'agent' && ctx.actor.role === 'architect';
      case 'designer':
        return ctx.actor.kind === 'agent' && ctx.actor.role === 'designer';
      case 'shipper':
        return ctx.actor.kind === 'agent' && ctx.actor.role === 'shipper';
    }
  });

  if (!permitted) {
    return {
      ok: false,
      code: 'NOT_PERMITTED',
      reason: `${ctx.actor.kind}:${ctx.actor.id} may not ${spec.name} (${from} -> ${to})`,
    };
  }

  return { ok: true, spec };
}

// A2A 1.0 wire mapping (docs/03 §3). A board task is the product entity; each
// execution attempt is an A2A task. States with wire=null exist only on the board.
export type A2ATaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED';

export const A2A_MAPPING: Record<TaskState, { wire: A2ATaskState | null; note: string }> = {
  backlog: { wire: null, note: 'board-only; a parked idea — no work attempt exists until promoted to todo' },
  todo: { wire: 'TASK_STATE_SUBMITTED', note: 'offered, awaiting claim' },
  designing: { wire: null, note: 'board-only; the channel designer is drafting mockups' },
  design_review: { wire: null, note: 'board-only; mockups proposed, awaiting the human design sign-off' },
  planning: { wire: null, note: 'board-only; an architect is drafting the implementation plan' },
  plan_review: { wire: null, note: 'board-only; the plan is proposed, awaiting approval (orchestrator/human)' },
  in_progress: { wire: 'TASK_STATE_WORKING', note: 'active work attempt' },
  blocked: { wire: 'TASK_STATE_INPUT_REQUIRED', note: 'awaiting input or auth' },
  in_review: { wire: null, note: 'work attempt COMPLETED with artifacts; a review A2A task opens' },
  done: { wire: null, note: 'review task COMPLETED (verdict: approve)' },
  shipping: { wire: null, note: 'board-only; the channel shipper is drafting the release plan' },
  ship_review: { wire: null, note: 'board-only; release plan proposed, awaiting the human sign-off' },
  releasing: { wire: null, note: 'board-only; approved plan executing — the checklist clears before the merge' },
  verifying: { wire: null, note: 'board-only; PR merged — the host is verifying post-merge CI + release pipelines before acceptance' },
  accepted: { wire: null, note: 'board-only human sign-off, recorded in events log' },
  closed: { wire: null, note: 'archived; cancellation maps to TASK_STATE_CANCELED on the active attempt' },
};
