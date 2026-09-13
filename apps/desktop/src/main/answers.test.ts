// The re-ask fix (2026-08-10, found live): a card's answered-state is PER CARD — an old
// "Not now" must never pre-answer a freshly re-sent proposal. answers.ts owns the rules;
// these tests are the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answersResolver, answersFrom } from '../renderer/src/answers';

const Q = 'Put "Draft fresh character logo directions for Flowe" on the board?';
const msg = (id: string, author_kind: string, body: string) => ({ id, author_kind, body });
const dec = (message_id: string | null, status: string, answer: string | null, question = Q) =>
  ({ message_id, question, status, answer });

test('the live regression: a re-sent card is NOT born answered by the earlier "Not now"', () => {
  const rows = [
    msg('m1', 'agent', `card asking: ${Q}`),          // card #1
    msg('m2', 'human', `**${Q}** → Not now`),          // the answer to card #1
    msg('m3', 'agent', 'research report'),
    msg('m4', 'agent', `fresh card: ${Q}`),            // the re-ask
  ];
  const answers = answersResolver(rows, [
    dec('m1', 'answered', 'Not now'),
    dec('m4', 'open', null),                           // the server's fresh OPEN row
  ]);
  assert.equal(answers('m1').get(Q), 'Not now', 'the ORIGINAL card stays collapsed');
  assert.equal(answers('m4').has(Q), false, 'the RE-SENT card must be open — this is the bug');
});

test('an answer after the re-ask collapses it (and any still-open same-question card above)', () => {
  const rows = [
    msg('m1', 'agent', 'card'),
    msg('m2', 'human', `**${Q}** → Not now`),
    msg('m3', 'agent', 'fresh card'),
    msg('m4', 'human', `**${Q}** → Create the task`),
  ];
  const answers = answersResolver(rows, []);
  assert.equal(answers('m3').get(Q), 'Create the task');
  // the earlier card sees the LAST word — matching the server, which flips every open
  // same-question row on an answer
  assert.equal(answers('m1').get(Q), 'Create the task');
});

test('the synced row is authoritative for ITS message only', () => {
  const rows = [msg('m1', 'agent', 'card'), msg('m2', 'agent', 'fresh card')];
  const answers = answersResolver(rows, [
    dec('m1', 'answered', 'Not now'),
    dec('m2', 'open', null),
  ]);
  assert.equal(answers('m1').get(Q), 'Not now');
  assert.equal(answers('m2').has(Q), false);
});

test('an answered row with no string-match still collapses (Mission Control on another machine)', () => {
  const rows = [msg('m1', 'agent', 'card')];
  const answers = answersResolver(rows, [dec('m1', 'answered', 'Ship it')]);
  assert.equal(answers('m1').get(Q), 'Ship it');
});

test('a dismissed row collapses its card but never overrides a later typed answer', () => {
  const rows = [msg('m1', 'agent', 'card'), msg('m2', 'human', `**${Q}** → Actually yes`)];
  const dismissed = answersResolver([msg('m1', 'agent', 'card')], [dec('m1', 'dismissed', null)]);
  assert.equal(dismissed('m1').get(Q), 'dismissed');
  const typedWins = answersResolver(rows, [dec('m1', 'dismissed', null)]);
  assert.equal(typedWins('m1').get(Q), 'Actually yes');
});

test('an unknown message id degrades to the whole-thread reading, never to "unanswered"', () => {
  const rows = [msg('m1', 'human', `**${Q}** → Not now`)];
  const answers = answersResolver(rows, []);
  assert.equal(answers('missing').get(Q), 'Not now');
});

test('agent-authored → lines never count as answers, in either derivation', () => {
  const rows = [msg('m1', 'agent', `**${Q}** → Not now`)];
  assert.equal(answersResolver(rows, [])('missing').has(Q), false);
  assert.equal(answersFrom(rows).has(Q), false);
});

// ── the ghost leak (2026-08-10, found live) ──────────────────────────────────────────────────
// Replying in the task PEEK made the parent conversation grow a ghost narrating the task's work:
// both threads live in the same room, and the fallback attribution was "an agent in this room is
// thinking". The rule below is what the two surfaces now share — an agent streaming into ANOTHER
// thread is not working here — expressed as the predicate both call sites use.
const worksHere = (owners: Map<string, string>, agentName: string, myKey: string) =>
  (owners.get(agentName) ?? myKey) === myKey;

test('an agent streaming into another thread does not ghost this one', () => {
  const owners = new Map([['rex', 'c-build:task-1016']]);
  assert.equal(worksHere(owners, 'rex', 'c-build:task-1016'), true, 'the thread it IS streaming into still ghosts');
  assert.equal(worksHere(owners, 'rex', 'c-build:convo-9'), false, 'the parent conversation must NOT — this was the live bug');
});

test('an agent streaming nowhere keeps the room-wide fallback (deltaless runtimes)', () => {
  const owners = new Map<string, string>();
  assert.equal(worksHere(owners, 'sol', 'c-build:convo-9'), true, 'no stream at all = the old behaviour, unchanged');
});

test('the guard is per agent — one busy agent does not mute another', () => {
  const owners = new Map([['rex', 'c-build:task-1016']]);
  assert.equal(worksHere(owners, 'mira', 'c-build:convo-9'), true);
});
