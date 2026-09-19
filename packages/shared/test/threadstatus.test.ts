// The three words a thread can wear, derived — and the one rule that makes settle safe: a gate or a
// card born AFTER the stamp brings the thread back.
import { describe, expect, it } from 'vitest';
import { canSettle, needsYouWhy, threadStatus, type StatusInput } from '../src/threadstatus';

const T0 = '2026-09-08T10:00:00.000Z';
const T1 = '2026-09-08T10:05:00.000Z';
const T2 = '2026-09-08T10:10:00.000Z';
const base: StatusInput = { task: null, card: null, live: false, lastAuthorKind: null, lastAt: null, settledAt: null };
const task = (state: string, extra: Partial<StatusInput['task'] & object> = {}) => ({ state, updated_at: T0, ...extra });
const card = (extra: Partial<NonNullable<StatusInput['card']>> = {}) => ({ status: 'open', created_at: T0, allow_other: 1, ...extra });

describe('threadStatus', () => {
  it('a human gate nobody answered needs you', () => {
    for (const s of ['plan_review', 'design_review', 'ship_review', 'done', 'blocked']) {
      expect(threadStatus({ ...base, task: task(s) })).toBe('needs_you');
    }
  });
  it('a gate you already replied to is the agent\'s turn (awaitingAgent), except done', () => {
    expect(threadStatus({ ...base, task: task('plan_review', { last_human_msg_at: T1 }) })).toBe('in_progress');
    // done clears on the human\'s WORD, which the orchestrator applies — until then it still needs you
    expect(threadStatus({ ...base, task: task('done', { last_human_msg_at: T1 }) })).toBe('needs_you');
  });
  it('settle hides a gate that predates the stamp, and nothing newer', () => {
    expect(threadStatus({ ...base, task: task('done'), settledAt: T1 })).toBe('settled');
    // the task moved again after the settle: a NEW gate, so it comes back
    expect(threadStatus({ ...base, task: task('done', { updated_at: T2 }), settledAt: T1 })).toBe('needs_you');
  });
  it('an open card needs you; a card answered in prose does not; a strict card cannot be answered in prose', () => {
    expect(threadStatus({ ...base, card: card() })).toBe('needs_you');
    expect(threadStatus({ ...base, card: card({ human_replied_at: T1 }), lastAuthorKind: 'agent' })).toBe('settled');
    expect(threadStatus({ ...base, card: card({ allow_other: 0, human_replied_at: T1 }) })).toBe('needs_you');
  });
  it('a settle stamp older than the card does not hide it; a newer one does', () => {
    expect(threadStatus({ ...base, card: card({ created_at: T2 }), settledAt: T1 })).toBe('needs_you');
    expect(threadStatus({ ...base, card: card({ created_at: T0 }), settledAt: T1, lastAuthorKind: 'agent' })).toBe('settled');
  });
  it('work in flight is in progress: a live run, an active state, a born-approved unit', () => {
    expect(threadStatus({ ...base, live: true, lastAuthorKind: 'agent' })).toBe('in_progress');
    for (const s of ['todo', 'planning', 'designing', 'in_progress', 'in_review', 'shipping', 'releasing', 'verifying']) {
      expect(threadStatus({ ...base, task: task(s) })).toBe('in_progress');
    }
    expect(threadStatus({ ...base, task: task('plan_review', { plan_approved_at: T0 }) })).toBe('in_progress');
  });
  it('a chat is in progress while the agent owes you a reply, settled once it answered', () => {
    expect(threadStatus({ ...base, lastAuthorKind: 'human', lastAt: T1 })).toBe('in_progress');
    expect(threadStatus({ ...base, lastAuthorKind: 'agent', lastAt: T1 })).toBe('settled');
    // you settled it after you spoke: it stays settled until someone speaks again
    expect(threadStatus({ ...base, lastAuthorKind: 'human', lastAt: T0, settledAt: T1 })).toBe('settled');
    expect(threadStatus({ ...base, lastAuthorKind: 'human', lastAt: T2, settledAt: T1 })).toBe('in_progress');
  });
  it('finished and parked work is settled', () => {
    for (const s of ['accepted', 'closed', 'backlog']) expect(threadStatus({ ...base, task: task(s) })).toBe('settled');
  });
  it('a setup checklist is yours until it is finished', () => {
    expect(threadStatus({ ...base, task: task('todo', { kind: 'setup' }) })).toBe('needs_you');
    expect(threadStatus({ ...base, task: task('in_progress', { kind: 'setup', last_human_msg_at: T1 }) })).toBe('needs_you');
    expect(threadStatus({ ...base, task: task('done', { kind: 'setup' }) })).toBe('settled');
  });
  it('a conversation carries the gates of the units it owns (docs/41: an anchored unit has no row)', () => {
    expect(threadStatus({ ...base, lastAuthorKind: 'agent', owned: [task('done')] })).toBe('needs_you');
    expect(threadStatus({ ...base, lastAuthorKind: 'agent', owned: [task('done')], settledAt: T1 })).toBe('settled');
    expect(threadStatus({ ...base, lastAuthorKind: 'agent', owned: [task('in_progress')] })).toBe('in_progress');
    expect(threadStatus({ ...base, lastAuthorKind: 'agent', owned: [task('accepted')] })).toBe('settled');
  });
  it('a subtask never needs you on its own row (its gates belong to its parent)', () => {
    expect(threadStatus({ ...base, task: task('done', { parent_task_id: 'p' }) })).not.toBe('needs_you');
  });
});

describe('needsYouWhy', () => {
  it('a card leads, and names who asks', () => {
    expect(needsYouWhy({ task: task('done'), card: { question: 'Post at 9?' }, asker: 'rex' })).toBe('rex asks: Post at 9?');
  });
  it('a gate says what waits, and a done task says the word to say', () => {
    expect(needsYouWhy({ task: task('plan_review'), card: null })).toBe('The plan waits for your approval.');
    expect(needsYouWhy({ task: task('done', { pr_number: 58 }), card: null })).toBe('Review passed. Say merge to land PR #58.');
    expect(needsYouWhy({ task: task('done'), card: null })).toBe('Review passed. Say accept to close it.');
    expect(needsYouWhy({ task: task('in_progress'), card: null })).toBeNull();
  });
});

describe('canSettle — the row offers the act only when the stamp can move something', () => {
  it('a gate or a card waiting on you settles', () => {
    expect(canSettle({ ...base, task: task('done') })).toBe(true);
    expect(canSettle({ ...base, card: card() })).toBe(true);
  });
  it('a chat where you spoke last settles', () => {
    expect(canSettle({ ...base, lastAuthorKind: 'human', lastAt: T1 })).toBe(true);
  });
  it('a live run alone offers nothing — the stamp does not gate liveness', () => {
    expect(canSettle({ ...base, live: true, lastAuthorKind: 'agent' })).toBe(false);
    // …but a gate UNDER a live run is still yours: settling takes it out of the needs-you queue,
    // even though the row keeps reading "in progress" until the run ends
    expect(canSettle({ ...base, live: true, task: task('done') })).toBe(true);
    expect(threadStatus({ ...base, live: true, task: task('done'), settledAt: T1 })).toBe('in_progress');
  });
  it('an active task offers nothing — the board moves it, not you', () => {
    for (const s of ['todo', 'planning', 'in_progress', 'in_review']) {
      expect(canSettle({ ...base, task: task(s) })).toBe(false);
    }
  });
  it('a thread that already reads settled offers nothing — settling again changes nothing', () => {
    expect(canSettle({ ...base, lastAuthorKind: 'agent', lastAt: T1 })).toBe(false);
    expect(canSettle({ ...base, task: task('accepted') })).toBe(false);
    // ALREADY STAMPED: no standing reverse act — unsettle is the undo of a settle you just made
    expect(canSettle({ ...base, task: task('done'), settledAt: T1 })).toBe(false);
    expect(canSettle({ ...base, lastAuthorKind: 'human', lastAt: T0, settledAt: T1 })).toBe(false);
  });
  it('a gate born after the stamp needs you again, so the act comes back', () => {
    expect(canSettle({ ...base, task: task('done', { updated_at: T2 }), settledAt: T1 })).toBe(true);
  });
});

describe('drafts waiting on the owned units (the release-drafts round, §4.5)', () => {
  const drafts = { draftsWaiting: 4, draftsAt: T1 };
  it('drafts nobody answered need you, and the row offers Settle', () => {
    expect(threadStatus({ ...base, ...drafts, lastAuthorKind: 'agent', lastAt: T1 })).toBe('needs_you');
    expect(canSettle({ ...base, ...drafts, lastAuthorKind: 'agent', lastAt: T1 })).toBe(true);
  });
  it('a human word after the newest draft hands the ball back: the agent owes the revision', () => {
    expect(threadStatus({ ...base, ...drafts, lastAuthorKind: 'human', lastAt: T2 })).toBe('in_progress');
    // …but a word BEFORE they landed (the ask itself) changes nothing
    expect(threadStatus({ ...base, ...drafts, lastAuthorKind: 'human', lastAt: T0 })).toBe('needs_you');
  });
  it('a settle newer than the drafts hides them; an older one does not', () => {
    expect(threadStatus({ ...base, ...drafts, lastAuthorKind: 'agent', lastAt: T1, settledAt: T2 })).toBe('settled');
    expect(canSettle({ ...base, ...drafts, lastAuthorKind: 'agent', lastAt: T1, settledAt: T2 })).toBe(false);
    expect(threadStatus({ ...base, ...drafts, lastAuthorKind: 'agent', lastAt: T1, settledAt: T0 })).toBe('needs_you');
  });
  it('an unknown moment is never hidden: drafts with no birth still need you', () => {
    expect(threadStatus({ ...base, draftsWaiting: 1, draftsAt: null, lastAuthorKind: 'human', lastAt: T2 })).toBe('needs_you');
  });
  it('zero drafts change nothing', () => {
    expect(threadStatus({ ...base, draftsWaiting: 0, draftsAt: T1, lastAuthorKind: 'agent', lastAt: T1 })).toBe('settled');
  });
  it('needsYouWhy names the drafts, after a card and before the gate', () => {
    expect(needsYouWhy({ task: task('done'), card: null, draftsWaiting: 4 })).toBe('The drafts wait for your approval.');
    expect(needsYouWhy({ task: task('done'), card: { question: 'Post at 9?' }, asker: 'rex', draftsWaiting: 4 })).toBe('rex asks: Post at 9?');
  });
});
