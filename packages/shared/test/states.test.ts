import { describe, expect, it } from 'vitest';
import {
  A2A_MAPPING,
  TASK_STATES,
  TRANSITIONS,
  canTransition,
  evaluateTransition,
  legalTargets,
  type Actor,
  type TaskState,
  type TransitionContext,
} from '../src/index';

function ctx(partial: Partial<TransitionContext> & { actor: Actor }): TransitionContext {
  return {
    isAssignee: false,
    isCreator: false,
    isReviewerPoolMember: false,
    artifactCount: 0,
    repoBacked: false,
    pushedSha: null,
    shipPlanApproved: false,
    planApproved: false,
    shipItemsPending: 0,
    isSubtask: false,
    subtasksPending: 0,
    isSetup: false,
    ...partial,
  };
}

const human: Actor = { kind: 'human', id: 'george' };
const worker: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const reviewer: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };
const orchestrator: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const architect: Actor = { kind: 'agent', id: 'atlas', role: 'architect' };
const designer: Actor = { kind: 'agent', id: 'iris', role: 'designer' };

describe('transition graph', () => {
  it('matches the documented spec exactly — every from/to pair', () => {
    const legal = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`));
      }
    }
  });

  // Closed was terminal until 2026-08-11, when a closed task's reply field was disabled and
  // reopening became the way back in (George). It has exactly ONE edge out, and the narrowness
  // is the invariant now: only `todo` (never mid-phase — the host aborts the run and drops the
  // worktree on close), and only a HUMAN (an agent that could reopen its own cancelled work
  // would make "closed" a suggestion rather than a decision).
  it('closed has exactly one edge out: a human reopening it into todo', () => {
    expect(legalTargets('closed')).toEqual(['todo']);
    expect(evaluateTransition('closed', 'todo', ctx({ actor: human })).ok).toBe(true);
    // HUMAN ONLY — not even the orchestrator, which may cancel but may not un-cancel. The CODE
    // matters as much as the refusal: NOT_PERMITTED means "wrong actor", and a client reading it
    // would reasonably go looking for a right one. There isn't one.
    expect(evaluateTransition('closed', 'todo', ctx({ actor: orchestrator }))).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
    expect(evaluateTransition('closed', 'todo', ctx({ actor: worker }))).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
    // …and it is still the end of the road in every other direction
    for (const to of ['in_progress', 'in_review', 'done', 'accepted', 'blocked', 'planning', 'designing'] as const) {
      expect(canTransition('closed', to), `closed -> ${to}`).toBe(false);
    }
  });

  it('never allows skipping review or acceptance', () => {
    expect(canTransition('in_progress', 'accepted')).toBe(false);
    expect(canTransition('in_review', 'accepted')).toBe(false);
    // in_progress/todo -> done became PAIR-legal for the subtask `finish` move
    // (docs/24) — but the invariant holds where it now lives: a PARENT task is
    // structurally refused that shortcut, review is its only road to done.
    for (const from of ['in_progress', 'todo'] as const) {
      const v = evaluateTransition(from, 'done', ctx({ actor: human, isAssignee: true, isSubtask: false, artifactCount: 5 }), 'finish');
      expect(v.ok, `${from} -> done for a parent`).toBe(false);
    }
    // NB: done -> closed IS legal — a human may cancel/kill a done-but-unaccepted task
    // ("review isn't a one-way ratchet"). That's a kill, not skipping past acceptance.
  });
});

describe('structural guards (enforced, not prompted)', () => {
  it('submit without artifacts is rejected', () => {
    const v = evaluateTransition('in_progress', 'in_review', ctx({ actor: worker, isAssignee: true }));
    expect(v).toMatchObject({ ok: false, code: 'EVIDENCE_REQUIRED' });
  });

  it('repo-backed submit without a pushed SHA is rejected', () => {
    const v = evaluateTransition(
      'in_progress',
      'in_review',
      ctx({ actor: worker, isAssignee: true, artifactCount: 2, repoBacked: true }),
    );
    expect(v).toMatchObject({ ok: false, code: 'PUSH_REQUIRED' });
  });

  it('repo-backed submit with artifacts + SHA passes', () => {
    const v = evaluateTransition(
      'in_progress',
      'in_review',
      ctx({ actor: worker, isAssignee: true, artifactCount: 2, repoBacked: true, pushedSha: '8f3c2d1' }),
    );
    expect(v.ok).toBe(true);
  });

  it('repo-less tasks keep the artifact-only contract', () => {
    const v = evaluateTransition(
      'in_progress',
      'in_review',
      ctx({ actor: worker, isAssignee: true, artifactCount: 1, repoBacked: false }),
    );
    expect(v.ok).toBe(true);
  });

  it('self-review is blocked, for agents and humans alike', () => {
    const agentSelf = evaluateTransition(
      'in_review',
      'done',
      ctx({ actor: reviewer, isAssignee: true, isReviewerPoolMember: true }),
    );
    expect(agentSelf).toMatchObject({ ok: false, code: 'SELF_REVIEW_BLOCKED' });

    const humanSelf = evaluateTransition('in_review', 'in_progress', ctx({ actor: human, isAssignee: true }));
    expect(humanSelf).toMatchObject({ ok: false, code: 'SELF_REVIEW_BLOCKED' });
  });

  it('accept is human-only — even the orchestrator cannot accept', () => {
    const v = evaluateTransition('done', 'accepted', ctx({ actor: orchestrator }));
    expect(v).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
    const ok = evaluateTransition('done', 'accepted', ctx({ actor: human }));
    expect(ok.ok).toBe(true);
  });
});

describe('role gates', () => {
  it('a worker agent outside the reviewer pool cannot approve', () => {
    const v = evaluateTransition('in_review', 'done', ctx({ actor: worker }));
    expect(v).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('a reviewer-pool agent can approve someone else\'s work', () => {
    const v = evaluateTransition('in_review', 'done', ctx({ actor: reviewer, isReviewerPoolMember: true }));
    expect(v.ok).toBe(true);
  });

  it('a human can always review', () => {
    expect(evaluateTransition('in_review', 'done', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('in_review', 'in_progress', ctx({ actor: human })).ok).toBe(true);
  });

  it('the orchestrator can bounce an in_review task (relaying the human) — consistent with done', () => {
    // rex's request_changes tool ("send the drafts back to plume") must work from in_review, not
    // only from done. A worker still can't, and the assignee can't request_changes its own work.
    expect(evaluateTransition('in_review', 'in_progress', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('done', 'in_progress', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('in_review', 'in_progress', ctx({ actor: worker }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    expect(evaluateTransition('in_review', 'in_progress', ctx({ actor: orchestrator, isAssignee: true }))).toMatchObject({ ok: false });
  });

  it('only the assignee may submit', () => {
    const v = evaluateTransition(
      'in_progress',
      'in_review',
      ctx({ actor: worker, isAssignee: false, artifactCount: 1 }),
    );
    expect(v).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('orchestrator can cancel from todo, a worker cannot', () => {
    expect(evaluateTransition('todo', 'closed', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('todo', 'closed', ctx({ actor: worker }))).toMatchObject({
      ok: false,
      code: 'NOT_PERMITTED',
    });
  });

  it('archive is for humans and orchestrators', () => {
    expect(evaluateTransition('accepted', 'closed', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('accepted', 'closed', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('accepted', 'closed', ctx({ actor: worker }))).toMatchObject({ ok: false });
  });
});

describe('block from any working stage (unblock returns to blocked_from)', () => {
  it('stage agents may block their own stage; outsiders may not; todo cannot block', () => {
    expect(evaluateTransition('planning', 'blocked', ctx({ actor: architect })).ok).toBe(true);
    expect(evaluateTransition('designing', 'blocked', ctx({ actor: designer })).ok).toBe(true);
    expect(evaluateTransition('in_review', 'blocked', ctx({ actor: reviewer, isReviewerPoolMember: true })).ok).toBe(true);
    expect(evaluateTransition('planning', 'blocked', ctx({ actor: worker }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    expect(evaluateTransition('designing', 'blocked', ctx({ actor: reviewer, isReviewerPoolMember: true }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    expect(canTransition('todo', 'blocked')).toBe(false);
  });

  it('every blockable stage has its unblock return edge', () => {
    for (const s of ['in_progress', 'planning', 'designing', 'in_review'] as const) {
      expect(canTransition(s, 'blocked'), `${s} -> blocked`).toBe(true);
      expect(canTransition('blocked', s), `blocked -> ${s}`).toBe(true);
      expect(evaluateTransition('blocked', s, ctx({ actor: human })).ok, `human unblocks to ${s}`).toBe(true);
    }
  });
});

describe('design lifecycle (docs/14)', () => {
  it('request_design is orchestrator/human — from todo, and from in_progress once owned', () => {
    expect(evaluateTransition('todo', 'designing', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('todo', 'designing', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('todo', 'designing', ctx({ actor: worker }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });

    // in_progress -> designing is NEW and load-bearing (docs/29 §4d): under ownership rex claims the
    // task FIRST and only then decides it needs a design round. While the edge existed only from
    // todo, taking a task made its own design phase unreachable — the board could describe an owned
    // round and nothing could get into one.
    expect(evaluateTransition('in_progress', 'designing', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('in_progress', 'planning', ctx({ actor: orchestrator })).ok).toBe(true);

    // but it stays the OWNER's call. A worker deciding mid-build that it wants a design round is
    // scope creep with a transition; it blocks back instead.
    expect(evaluateTransition('in_progress', 'designing', ctx({ actor: worker, isAssignee: true })))
      .toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    // and planning still cannot bounce sideways into designing
    expect(canTransition('planning', 'designing')).toBe(false);
  });

  it('the designer or the OWNER proposes mockups — nobody else', () => {
    // Rex owns the whole flow including design: it brings a designer IN as a subagent seated on the
    // channel designer's config, rather than handing the task over. A subagent has no board
    // identity, so the owner proposes what its subtree drew.
    expect(evaluateTransition('designing', 'design_review', ctx({ actor: designer })).ok).toBe(true);
    expect(evaluateTransition('designing', 'design_review', ctx({ actor: orchestrator })).ok).toBe(true);
    for (const a of [worker, architect, reviewer]) {
      expect(evaluateTransition('designing', 'design_review', ctx({ actor: a }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    }
  });

  it('proposing is NOT approving — the owner still cannot sign off its own round', () => {
    // The pair that matters: the owner drawing and proposing must not have widened the gate behind
    // it. Mockup approval is the human's, with no auto path, exactly as before.
    expect(evaluateTransition('designing', 'design_review', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('design_review', 'planning', ctx({ actor: orchestrator }))).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
  });

  it('NOTHING is built from an unapproved plan — the gate that was prompt etiquette', () => {
    // Before 0104 this edge had no coverage at all, which is how "the human approved the plan"
    // survived as an instruction rather than a rule. The design lifecycle gets this for free by
    // having no designing -> in_progress edge; the plan gate cannot, because the edge is a real
    // claim that is legal — just not before a human signs off.
    const claiming = { actor: worker, isAssignee: true } as const;
    expect(evaluateTransition('plan_review', 'in_progress', ctx({ ...claiming, planApproved: false })))
      .toMatchObject({ ok: false, code: 'PLAN_NOT_APPROVED' });
    expect(evaluateTransition('plan_review', 'in_progress', ctx({ ...claiming, planApproved: true })).ok).toBe(true);
  });

  it('the gate holds for the OWNER too — rex cannot approve its own plan by claiming', () => {
    // The failure this prevents is specific to ownership: rex is the assignee on a task it owns, so
    // without the flag it could walk its own plan straight into in_progress and never ask.
    expect(evaluateTransition('plan_review', 'in_progress', ctx({ actor: orchestrator, isAssignee: true, planApproved: false })))
      .toMatchObject({ ok: false, code: 'PLAN_NOT_APPROVED' });
  });

  it('an unapproved plan can still be revised or cancelled — the gate blocks BUILDING, not moving', () => {
    // A gate that froze the task would be worse than no gate: the human's other two answers are
    // "change it" and "drop it", and both must stay open while the plan is unapproved.
    expect(evaluateTransition('plan_review', 'planning', ctx({ actor: orchestrator, planApproved: false })).ok).toBe(true);
    expect(evaluateTransition('plan_review', 'closed', ctx({ actor: human, planApproved: false })).ok).toBe(true);
  });

  it('the architect or the OWNER proposes a plan — same reason, same shape', () => {
    // An architect subagent has no board identity either, so the owner proposes the plan it
    // commissioned. Nothing else may: a worker or reviewer reaching plan_review is a routing bug.
    expect(evaluateTransition('planning', 'plan_review', ctx({ actor: architect })).ok).toBe(true);
    expect(evaluateTransition('planning', 'plan_review', ctx({ actor: orchestrator })).ok).toBe(true);
    for (const a of [worker, designer, reviewer]) {
      expect(evaluateTransition('planning', 'plan_review', ctx({ actor: a }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    }
  });

  it('design approval is human-only — no auto-approve path exists, even for the orchestrator', () => {
    expect(evaluateTransition('design_review', 'planning', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('design_review', 'planning', ctx({ actor: orchestrator }))).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
    expect(evaluateTransition('design_review', 'planning', ctx({ actor: designer }))).toMatchObject({ ok: false, code: 'HUMAN_ONLY' });
  });

  it('revise_design sends it back to the designer (orchestrator or human)', () => {
    expect(evaluateTransition('design_review', 'designing', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('design_review', 'designing', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('design_review', 'designing', ctx({ actor: designer }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('nothing is built from an unapproved design', () => {
    expect(canTransition('designing', 'in_progress')).toBe(false);
    expect(canTransition('design_review', 'in_progress')).toBe(false);
  });
});

describe('backlog lifecycle (docs/15)', () => {
  it('promote (backlog -> todo) is human/orchestrator only', () => {
    expect(evaluateTransition('backlog', 'todo', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('backlog', 'todo', ctx({ actor: orchestrator })).ok).toBe(true);
    for (const a of [worker, reviewer, architect, designer]) {
      expect(evaluateTransition('backlog', 'todo', ctx({ actor: a }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
    }
  });

  it('a parked item cannot be claimed, worked, designed, planned, or blocked', () => {
    expect(canTransition('backlog', 'in_progress')).toBe(false);
    expect(canTransition('backlog', 'designing')).toBe(false);
    expect(canTransition('backlog', 'planning')).toBe(false);
    expect(canTransition('backlog', 'blocked')).toBe(false);
    expect(canTransition('backlog', 'in_review')).toBe(false);
    // even the agent that parked it cannot promote its own idea into work
    expect(evaluateTransition('backlog', 'todo', ctx({ actor: worker, isCreator: true, isAssignee: true }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('cancel from backlog: humans, the orchestrator, and the creator (an agent may retract its own parked idea)', () => {
    expect(evaluateTransition('backlog', 'closed', ctx({ actor: human })).ok).toBe(true);
    expect(evaluateTransition('backlog', 'closed', ctx({ actor: orchestrator })).ok).toBe(true);
    expect(evaluateTransition('backlog', 'closed', ctx({ actor: worker, isCreator: true })).ok).toBe(true);
    expect(evaluateTransition('backlog', 'closed', ctx({ actor: worker }))).toMatchObject({ ok: false, code: 'NOT_PERMITTED' });
  });

  it('nothing transitions INTO backlog — parking happens at creation only', () => {
    for (const s of TASK_STATES) {
      if (s === 'backlog') continue;
      expect(canTransition(s, 'backlog'), `${s} -> backlog`).toBe(false);
    }
  });
});

describe('ship lifecycle (docs/23)', () => {
  const shipper: Actor = { kind: 'agent', id: 'bosun', role: 'shipper' };

  it('wires the gate chain between review-approve and merge', () => {
    expect(canTransition('done', 'shipping')).toBe(true);
    expect(canTransition('shipping', 'ship_review')).toBe(true);
    expect(canTransition('ship_review', 'shipping')).toBe(true);
    expect(canTransition('ship_review', 'releasing')).toBe(true);
    // execute_ship lands in verifying (merge + post-merge verification), and
    // only confirm_release carries the task into accepted (docs/23 v2)
    expect(canTransition('releasing', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'accepted')).toBe(true);
    // escape hatches + late bounces + human kill switches — from EVERY ship state,
    // `shipping` included: the shipper's drafting stage was the one that caged the
    // human (a quiet shipper left no legal move), which is the whole point of the
    // "paved road, never a cage" contract above
    expect(canTransition('shipping', 'accepted')).toBe(true);
    expect(canTransition('ship_review', 'accepted')).toBe(true);
    expect(canTransition('releasing', 'accepted')).toBe(true);
    expect(canTransition('shipping', 'in_progress')).toBe(true);
    expect(canTransition('ship_review', 'in_progress')).toBe(true);
    expect(canTransition('releasing', 'in_progress')).toBe(true);
    expect(canTransition('verifying', 'in_progress')).toBe(true);
    // a second round of notes while the shipper drafts: the redraft self-loop
    expect(canTransition('shipping', 'shipping')).toBe(true);
    expect(canTransition('shipping', 'closed')).toBe(true);
    expect(canTransition('ship_review', 'closed')).toBe(true);
    expect(canTransition('releasing', 'closed')).toBe(true);
    expect(canTransition('verifying', 'closed')).toBe(true);
    expect(canTransition('shipping', 'blocked')).toBe(true);
    expect(canTransition('blocked', 'shipping')).toBe(true);
    // there is deliberately NO done -> releasing shortcut: a checklist only goes
    // live through a proposed, human-approved plan. (The human ACCEPT out of a ship
    // state is not that shortcut — it ends the task without releasing, and only a
    // human may fire it; the role gate is asserted separately below.)
    expect(canTransition('done', 'releasing')).toBe(false);
    // and no shortcut INTO verifying either — only a cleared checklist gets there
    expect(canTransition('done', 'verifying')).toBe(false);
    expect(canTransition('ship_review', 'verifying')).toBe(false);
  });

  it('only the shipper claims ship prep', () => {
    expect(evaluateTransition('done', 'shipping', ctx({ actor: shipper }), 'claim_ship').ok).toBe(true);
    for (const a of [worker, orchestrator, reviewer, human]) {
      const v = evaluateTransition('done', 'shipping', ctx({ actor: a }), 'claim_ship');
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.code).toBe('NOT_PERMITTED');
    }
  });

  it('only the shipper proposes the release plan', () => {
    expect(evaluateTransition('shipping', 'ship_review', ctx({ actor: shipper }), 'propose_ship_plan').ok).toBe(true);
    const v = evaluateTransition('shipping', 'ship_review', ctx({ actor: human }), 'propose_ship_plan');
    expect(v.ok).toBe(false);
  });

  it('approve_ship_plan is a HUMAN sign-off — every agent is rejected', () => {
    expect(evaluateTransition('ship_review', 'releasing', ctx({ actor: human }), 'approve_ship_plan').ok).toBe(true);
    for (const a of [shipper, orchestrator, worker]) {
      const v = evaluateTransition('ship_review', 'releasing', ctx({ actor: a }), 'approve_ship_plan');
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.code).toBe('HUMAN_ONLY');
    }
  });

  it('execute_ship is refused until the plan is approved AND the list clears', () => {
    const unapproved = evaluateTransition('releasing', 'verifying', ctx({ actor: shipper, shipPlanApproved: false, shipItemsPending: 0 }), 'execute_ship');
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.code).toBe('SHIP_ITEMS_PENDING');

    const pending = evaluateTransition('releasing', 'verifying', ctx({ actor: shipper, shipPlanApproved: true, shipItemsPending: 2 }), 'execute_ship');
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.code).toBe('SHIP_ITEMS_PENDING');

    expect(evaluateTransition('releasing', 'verifying', ctx({ actor: shipper, shipPlanApproved: true, shipItemsPending: 0 }), 'execute_ship').ok).toBe(true);
    // and it is the SHIPPER's move — a worker with a cleared list is still rejected
    const worker2 = evaluateTransition('releasing', 'verifying', ctx({ actor: worker, shipPlanApproved: true, shipItemsPending: 0 }), 'execute_ship');
    expect(worker2.ok).toBe(false);
    if (!worker2.ok) expect(worker2.code).toBe('NOT_PERMITTED');
  });

  it('confirm_release is the shipper host\'s move out of verifying — nobody else\'s', () => {
    expect(evaluateTransition('verifying', 'accepted', ctx({ actor: shipper }), 'confirm_release').ok).toBe(true);
    for (const a of [worker, orchestrator, reviewer]) {
      const v = evaluateTransition('verifying', 'accepted', ctx({ actor: a }), 'confirm_release');
      expect(v.ok, `confirm_release as ${a.id}`).toBe(false);
      if (!v.ok) expect(v.code).toBe('NOT_PERMITTED');
    }
    // the human's exit from verifying is accept (the override), not confirm_release
    const h = evaluateTransition('verifying', 'accepted', ctx({ actor: human }), 'confirm_release');
    expect(h.ok).toBe(false);
  });

  it('the human escape hatch accepts straight past the gate — agents cannot', () => {
    // same edge as execute_ship, disambiguated by intent name: the human accept
    // carries no checklist guard (the gate is a paved road, never a cage)
    expect(evaluateTransition('releasing', 'accepted', ctx({ actor: human, shipPlanApproved: false, shipItemsPending: 5 }), 'accept').ok).toBe(true);
    expect(evaluateTransition('ship_review', 'accepted', ctx({ actor: human }), 'accept').ok).toBe(true);
    // …and over a red or hung post-merge verdict too — verifying never cages
    expect(evaluateTransition('verifying', 'accepted', ctx({ actor: human }), 'accept').ok).toBe(true);
    // …and out of the shipper's DRAFTING stage, where a quiet shipper used to
    // leave the human with no legal move at all
    expect(evaluateTransition('shipping', 'accepted', ctx({ actor: human }), 'accept').ok).toBe(true);
    const agent = evaluateTransition('ship_review', 'accepted', ctx({ actor: shipper }), 'accept');
    expect(agent.ok).toBe(false);
    if (!agent.ok) expect(agent.code).toBe('HUMAN_ONLY');
    const drafting = evaluateTransition('shipping', 'accepted', ctx({ actor: shipper }), 'accept');
    expect(drafting.ok).toBe(false);
    if (!drafting.ok) expect(drafting.code).toBe('HUMAN_ONLY');
    const agentVer = evaluateTransition('verifying', 'accepted', ctx({ actor: worker }), 'accept');
    expect(agentVer.ok).toBe(false);
    if (!agentVer.ok) expect(agentVer.code).toBe('HUMAN_ONLY');
  });
});

describe('subtasks (docs/24)', () => {
  const shipper: Actor = { kind: 'agent', id: 'bosun', role: 'shipper' };

  it('finish is a subtask-only move — assignee or human; parents never finish', () => {
    expect(evaluateTransition('in_progress', 'done', ctx({ actor: worker, isAssignee: true, isSubtask: true }), 'finish').ok).toBe(true);
    expect(evaluateTransition('in_progress', 'done', ctx({ actor: human, isSubtask: true }), 'finish').ok).toBe(true);
    // the boss check-off works straight from todo — no subtask can become a blocker
    expect(evaluateTransition('todo', 'done', ctx({ actor: human, isSubtask: true }), 'finish').ok).toBe(true);
    const agentFromTodo = evaluateTransition('todo', 'done', ctx({ actor: worker, isAssignee: true, isSubtask: true }), 'finish');
    expect(agentFromTodo.ok).toBe(false); // an agent finishes work it CLAIMED, not parked todos
    const parent = evaluateTransition('in_progress', 'done', ctx({ actor: worker, isAssignee: true }), 'finish');
    expect(parent.ok).toBe(false);
    if (!parent.ok) expect(parent.code).toBe('NOT_PERMITTED');
  });

  it('a subtask lives the lean life — every ceremony move is rejected', () => {
    for (const [from, to, name] of [
      ['in_progress', 'in_review', 'submit'],
      ['todo', 'designing', 'request_design'],
      ['todo', 'planning', 'request_plan'],
      ['in_progress', 'blocked', 'block'],
      ['done', 'shipping', 'claim_ship'],
    ] as const) {
      const v = evaluateTransition(from, to, ctx({ actor: human, isAssignee: true, isSubtask: true, artifactCount: 3 }), name);
      expect(v.ok, `${name} on a subtask`).toBe(false);
    }
    // the lean set stays open
    expect(evaluateTransition('todo', 'in_progress', ctx({ actor: worker, isAssignee: true, isSubtask: true }), 'claim').ok).toBe(true);
    expect(evaluateTransition('in_progress', 'closed', ctx({ actor: human, isSubtask: true }), 'cancel').ok).toBe(true);
  });

  it('a parent with open subtasks cannot pass submit / accept / ship gates', () => {
    for (const [from, to, name, actor] of [
      ['in_progress', 'in_review', 'submit', worker],
      ['done', 'accepted', 'accept', human],
      ['ship_review', 'releasing', 'approve_ship_plan', human],
      ['releasing', 'verifying', 'execute_ship', shipper],
      ['verifying', 'accepted', 'confirm_release', shipper],
    ] as const) {
      const v = evaluateTransition(from, to, ctx({ actor, isAssignee: actor === worker, artifactCount: 2, pushedSha: 'abc', repoBacked: true, shipPlanApproved: true, subtasksPending: 2 }), name);
      expect(v.ok, `${name} with open subtasks`).toBe(false);
      if (!v.ok) expect(v.code).toBe('SUBTASKS_PENDING');
    }
    // …and clears the moment they finish
    expect(evaluateTransition('done', 'accepted', ctx({ actor: human, subtasksPending: 0 }), 'accept').ok).toBe(true);
  });
});

describe('A2A 1.0 mapping (docs/03 §3)', () => {
  it('covers every board state', () => {
    for (const s of TASK_STATES) expect(A2A_MAPPING[s as TaskState]).toBeDefined();
  });

  it('maps the live attempt states to wire states', () => {
    expect(A2A_MAPPING.todo.wire).toBe('TASK_STATE_SUBMITTED');
    expect(A2A_MAPPING.in_progress.wire).toBe('TASK_STATE_WORKING');
    expect(A2A_MAPPING.blocked.wire).toBe('TASK_STATE_INPUT_REQUIRED');
  });

  it('keeps review, done, accepted as board-level (no direct wire state)', () => {
    expect(A2A_MAPPING.backlog.wire).toBeNull();
    expect(A2A_MAPPING.in_review.wire).toBeNull();
    expect(A2A_MAPPING.done.wire).toBeNull();
    expect(A2A_MAPPING.accepted.wire).toBeNull();
    expect(A2A_MAPPING.designing.wire).toBeNull();
    expect(A2A_MAPPING.design_review.wire).toBeNull();
  });
});
