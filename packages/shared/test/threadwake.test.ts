// Who picks up a thread reply that addresses nobody. A state missing from this
// policy fails silently in production — the human's message is simply dropped —
// so every state that can hold a conversation is pinned here.
// Run from packages/shared:
//   pnpm test threadwake
import { expect, test } from 'vitest';
import { unaddressedWake } from '../src/threadwake';

test('intake and plan approval go to the orchestrator', () => {
  expect(unaddressedWake('todo')).toBe('orchestrator');
  expect(unaddressedWake('plan_review')).toBe('orchestrator');
});

test('live work goes to the assignee', () => {
  expect(unaddressedWake('in_progress')).toBe('assignee');
  expect(unaddressedWake('blocked')).toBe('assignee');
});

// The #1034 dead letter: the design gate shipped after this policy was written, so an
// un-mentioned reply in a design thread woke nobody. The studio's composer posts plain
// thread messages by design (asking and note-taking must not move the FSM), which makes
// this the load-bearing path for the whole review conversation.
test('a design round answers its own thread — designing and design_review', () => {
  expect(unaddressedWake('designing')).toBe('assignee');
  expect(unaddressedWake('design_review')).toBe('assignee');
});

test('a content task is its conversation, even in_review', () => {
  expect(unaddressedWake('in_review', 'content')).toBe('assignee');
  expect(unaddressedWake('todo', 'content')).toBe('orchestrator'); // intake still routes first
  expect(unaddressedWake('accepted', 'content')).toBe(null);
  expect(unaddressedWake('closed', 'content')).toBe(null);
});

// Marketing-os round 3: the setup task's thread owns the room's first-run — the bootstrap
// posts there and every later playbook ask starts there, AFTER marketing.setup landed the
// checklist `done`. Silence here silences the marketing home session.
test('a setup task talks in every state but closed — done included', () => {
  expect(unaddressedWake('todo', 'setup')).toBe('orchestrator');
  expect(unaddressedWake('done', 'setup')).toBe('orchestrator');
  expect(unaddressedWake('closed', 'setup')).toBe(null);
});

test('settled and mention-only states stay silent', () => {
  // a build task in review is mention-only on purpose — the reviewer owns the verdict
  expect(unaddressedWake('in_review')).toBe(null);
  expect(unaddressedWake('accepted')).toBe(null);
  expect(unaddressedWake('closed')).toBe(null);
  expect(unaddressedWake('backlog')).toBe(null);
});

// the done line, the verdict card and scout's approval all tell the person to say "merge it" in the
// unit's thread (2026-10-05). until this rule that word woke nobody: a dead letter until the
// stale_done sweep a day later. the coordinator takes it, and accept_task's gate (the person's newest
// typed message says merge or accept) and the server floor decide whether anything merges.
// a content unit too: its marketer has no accept_task, so "accept" on a done launch run woke an
// agent that could not apply it (the review of round 2, 2026-10-05)
test('a done unit hands the person\'s word to the coordinator, whatever its kind', () => {
  expect(unaddressedWake('done')).toBe('orchestrator');
  expect(unaddressedWake('done', 'feature')).toBe('orchestrator');
  expect(unaddressedWake('done', 'content')).toBe('orchestrator');
  expect(unaddressedWake('done', 'setup')).toBe('orchestrator');
  // before done and after it, a content unit keeps its own rule
  expect(unaddressedWake('in_review', 'content')).toBe('assignee');
  expect(unaddressedWake('accepted', 'content')).toBe(null);
});

// A draw or a film is a button, not a reply (2026-09-27): a tab's picture ask on a finished unit's
// draft named nobody and woke nobody, so the card waited three minutes for a machine that never came.
test('a draw or a film finds a hand in every state; live work keeps its assignee', () => {
  expect(unaddressedWake('done', null, true)).toBe('orchestrator');
  expect(unaddressedWake('closed', 'content', true)).toBe('orchestrator');
  expect(unaddressedWake('in_review', null, true)).toBe('orchestrator');
  expect(unaddressedWake('in_progress', null, true)).toBe('assignee');
  expect(unaddressedWake('in_review', 'content', true)).toBe('assignee');
  // a plain reply is unchanged
  expect(unaddressedWake('accepted', null, false)).toBe(null);
});
