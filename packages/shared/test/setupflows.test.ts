// Setup flows (2026-08-09): the registry + the progress derivation, and the lean FSM life of a
// kind='setup' task. The live failure these pin: an abandoned marketing setup left NOTHING —
// the wizard was a card rendered from a null profile, so its state died with it and the room
// held no object to come back to.
import { describe, it, expect } from 'vitest';
import { MARKETING_SETUP_FLOW, SETUP_FLOWS, flowForChannelKind, setupProgress, setupProgressLabel } from '../src/setupflows';
import { evaluateTransition, type Actor, type TransitionContext } from '../src/states';

const human: Actor = { kind: 'human', id: 'george' };
const orch: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const ctx = (partial: Partial<TransitionContext>): TransitionContext => ({
  actor: human, isAssignee: false, isCreator: false, isReviewerPoolMember: false,
  artifactCount: 0, repoBacked: false, pushedSha: null,
  shipPlanApproved: false, planApproved: false, shipItemsPending: 0,
  isSubtask: false, subtasksPending: 0, isSetup: true,
  ...partial,
});

describe('the registry', () => {
  it('marketing has a flow; build deliberately has none yet', () => {
    expect(flowForChannelKind('marketing')).toBe(MARKETING_SETUP_FLOW);
    expect(flowForChannelKind('build')).toBeNull();
    expect(flowForChannelKind(null)).toBeNull();
    // versioned ids — a changed flow is a NEW id, an unchanged one never re-offers
    for (const f of Object.values(SETUP_FLOWS)) expect(f.id).toMatch(/\.v\d+$/);
  });
});

describe('setupProgress — derived from the synced profile, never from UI state', () => {
  it('a fresh room: nothing done, resume lands on the first step', () => {
    for (const raw of [null, undefined, '', '{}', 'not json']) {
      const p = setupProgress(MARKETING_SETUP_FLOW, raw);
      expect(p).toEqual({ done: 0, total: 4, next: 'product', complete: false });
    }
  });

  it('per-step writes advance it — leaving after two steps resumes at the third', () => {
    const p = setupProgress(MARKETING_SETUP_FLOW, JSON.stringify({ website: 'flowe.app', goal: 'first 1000' }));
    expect(p.done).toBe(2);
    expect(p.next).toBe('focus');
    expect(p.complete).toBe(false);
    expect(setupProgressLabel(MARKETING_SETUP_FLOW, p)).toBe('step 3 of 4 — Focus');
  });

  it('the progress marker covers skipped-optional and write-less steps', () => {
    // goal skipped (no write), marker says the goal step was passed
    const p = setupProgress(MARKETING_SETUP_FLOW, JSON.stringify({
      website: 'flowe.app', setup_progress: { flow: 'marketing.v1', step: 'goal' },
    }));
    expect(p.done).toBe(2);
    expect(p.next).toBe('focus');
  });

  it("another flow's marker does not count — versioned ids are the fence", () => {
    const p = setupProgress(MARKETING_SETUP_FLOW, JSON.stringify({
      setup_progress: { flow: 'marketing.v2', step: 'goal' },
    }));
    expect(p.done).toBe(0);
    expect(p.next).toBe('product');
  });

  it('an empty focus array is not a completed focus step', () => {
    const p = setupProgress(MARKETING_SETUP_FLOW, JSON.stringify({ website: 'x.dev', focus: [] }));
    expect(p.next).toBe('goal'); // goal first (unwritten), focus still pending too
    expect(p.done).toBe(1);
  });

  it('setup_at is the one authoritative COMPLETE — configured-before-flows rooms read done', () => {
    // exactly the release-day backfill question: this room must be left alone
    const p = setupProgress(MARKETING_SETUP_FLOW, JSON.stringify({
      website: 'flowe.app', focus: ['social'], setup_by: 'u1', setup_at: '2026-07-20T00:00:00Z',
    }));
    expect(p).toEqual({ done: 4, total: 4, next: null, complete: true });
    expect(setupProgressLabel(MARKETING_SETUP_FLOW, p)).toBe('complete');
  });
});

describe("a setup task's lean FSM life (finish/cancel only, by construction)", () => {
  it('finish lands it done straight from todo — the human completed the wizard', () => {
    expect(evaluateTransition('todo', 'done', ctx({}), 'finish').ok).toBe(true);
  });
  it('cancel is the opt-out valve', () => {
    expect(evaluateTransition('todo', 'closed', ctx({}), 'cancel').ok).toBe(true);
  });
  it('nothing else exists for it — no offer, claim, design, plan, block', () => {
    for (const [to, name] of [
      ['in_progress', 'claim'], ['designing', 'request_design'],
      ['planning', 'request_plan'], ['blocked', 'block'],
    ] as const) {
      const v = evaluateTransition('todo', to, ctx({ isAssignee: true, actor: orch }), name);
      expect(v.ok, `${name} on a setup task`).toBe(false);
      // block isn't even an edge out of todo, so it refuses one gate earlier — either
      // refusal is the invariant; the code just says which fence caught it
      if (!v.ok) expect(['NOT_PERMITTED', 'ILLEGAL_TRANSITION']).toContain(v.code);
    }
  });
  it('a plain task still cannot finish — the setup carve-out did not widen the parent rule', () => {
    const v = evaluateTransition('todo', 'done', ctx({ isSetup: false }), 'finish');
    expect(v.ok).toBe(false);
  });
});
