// Who holds the ball (needsyou.ts): the rule that stops Home asking you for something
// you already answered in the thread. Pure — no replica, no clock injection needed.
import { describe, expect, it } from 'vitest';
import { actionableByHuman, awaitingAgent, decisionHandled } from '../src/needsyou';

const at = (min: number) => new Date(Date.parse('2026-07-29T10:00:00Z') + min * 60_000).toISOString();

describe('awaitingAgent', () => {
  it('a reply after the gate opened hands the task back to the agent', () => {
    for (const state of ['design_review', 'plan_review', 'ship_review', 'blocked']) {
      expect(awaitingAgent({ state, updated_at: at(0), last_human_msg_at: at(1) }), state).toBe(true);
    }
  });

  it('a reply from BEFORE the gate opened does not count — that is the conversation that produced it', () => {
    expect(awaitingAgent({ state: 'plan_review', updated_at: at(10), last_human_msg_at: at(2) })).toBe(false);
  });

  it('silence keeps the card in the queue', () => {
    expect(awaitingAgent({ state: 'design_review', updated_at: at(0), last_human_msg_at: null })).toBe(false);
    expect(awaitingAgent({ state: 'design_review', updated_at: at(0) })).toBe(false);
  });

  it('done and unroutable todo are cleared by a BUTTON and by STAFFING, so prose never retires them', () => {
    expect(awaitingAgent({ state: 'done', updated_at: at(0), last_human_msg_at: at(5) })).toBe(false);
    expect(awaitingAgent({ state: 'todo', updated_at: at(0), last_human_msg_at: at(5) })).toBe(false);
  });

  it('working states are not gates at all', () => {
    expect(awaitingAgent({ state: 'in_progress', updated_at: at(0), last_human_msg_at: at(5) })).toBe(false);
  });
});

describe('decisionHandled', () => {
  const card = { status: 'open', created_at: at(0), allow_other: 1 };

  it('a prose reply after the ask retires a free-text card', () => {
    expect(decisionHandled({ ...card, human_replied_at: at(1) })).toBe(true);
  });

  it('a STRICT-choice card is never retired by prose — the agent is blocked on the exact option', () => {
    // permission gates, the design-provider pick, schedule confirmations: allowOther:false
    expect(decisionHandled({ ...card, allow_other: 0, human_replied_at: at(1) })).toBe(false);
    expect(decisionHandled({ ...card, allow_other: false, human_replied_at: at(1) })).toBe(false);
  });

  it('an already-answered row is not this rule’s business', () => {
    expect(decisionHandled({ ...card, status: 'answered', human_replied_at: at(1) })).toBe(false);
    expect(decisionHandled({ ...card, status: 'dismissed', human_replied_at: at(1) })).toBe(false);
  });

  it('a reply that predates the question answered a DIFFERENT question', () => {
    expect(decisionHandled({ ...card, created_at: at(10), human_replied_at: at(3) })).toBe(false);
    expect(decisionHandled({ ...card, human_replied_at: null })).toBe(false);
  });

  it('a missing allow_other reads as free-text (the server default is allowOther !== false)', () => {
    expect(decisionHandled({ status: 'open', created_at: at(0), human_replied_at: at(1) })).toBe(true);
  });
});


describe("actionableByHuman", () => {
  it("keeps a top-level task in the queue", () => {
    expect(actionableByHuman({ state: "done", updated_at: at(0) })).toBe(true);
    expect(actionableByHuman({ state: "done", updated_at: at(0), parent_task_id: null })).toBe(true);
  });

  it("drops a SUBTASK — the clog this exists to stop", () => {
    // `finish` lands a subtask in `done` (states.ts), which the queue reads as "ready to
    // accept" — but evaluateTransition REFUSES accept on a subtask ("its parent's gates cover
    // that"). So the card offered a button the server could never honour, and no human action
    // could clear it: one permanent card per finished subtask (George, 2026-08-04).
    expect(actionableByHuman({ state: "done", updated_at: at(0), parent_task_id: "t-parent" })).toBe(false);
  });

  it("is about WHOSE gate it is, not which state it is in", () => {
    // every state the queue reads, for a subtask, is the parent's business
    for (const state of ["done", "plan_review", "design_review", "ship_review", "blocked", "todo"]) {
      expect(actionableByHuman({ state, updated_at: at(0), parent_task_id: "t-parent" })).toBe(false);
    }
  });
});
