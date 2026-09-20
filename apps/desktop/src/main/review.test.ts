// The review tab's model (mockups/review-in-tab.html, docs/36 §13): a review is
// `{ artifact, gate, verdict[] }` — the ARTIFACT supplies the bytes and the mode segment, the
// GATE supplies who may decide and what the decision is called, and the VERDICTS are the buttons.
// The point of these tests is the type claim: an implementation plan, a release plan and a design
// round differ only in the DATA bound to one component. Every assertion below that compares two
// kinds is there to prove that a second component per kind would be the wrong model.
//
// Run from apps/desktop:
//   pnpm exec tsx --test src/main/review.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITIONS } from '@neuramesh/shared';
import { addComment, bindReview, deleteComment, diffRounds, editComment, humanOnly, reviewKind, reviewPacket, type ReviewBinding, type ReviewComment, type ReviewSubject } from '../renderer/src/review';

const PLAN = 'implementation-plan-v3.md';
const SHIP = 'ship-plan-v2.md';
const DESIGN = 'design-mockup-v1-porch.html';

const planDoc = '# Acme landing\n\nDeliver the landing experience.\n\n## Steps\n\n1. Confirm repo & baseline.\n\n2. Design handoff.';
const shipDoc = '# Release v0.71.0\n\nBackend is already live.\n\n## Checklist\n\n- bosun — verify CI';
const designDoc = '<!doctype html><html><body><h1>Porch</h1></body></html>';

const subject = (over: Partial<ReviewSubject> = {}): ReviewSubject => ({
  taskNumber: 1005,
  taskState: 'plan_review',
  rounds: [{ name: PLAN, content: planDoc }],
  ...over,
});

const bindPlan = (over: Partial<ReviewSubject> = {}) =>
  bindReview({ name: PLAN, content: planDoc, kind: 'doc' }, subject(over));
const bindShip = (over: Partial<ReviewSubject> = {}) =>
  bindReview({ name: SHIP, content: shipDoc, kind: 'doc' }, subject({ taskState: 'ship_review', rounds: [{ name: SHIP, content: shipDoc }], ...over }));
const bindDesign = (over: Partial<ReviewSubject> = {}) =>
  bindReview({ name: DESIGN, content: designDoc, kind: 'design' }, subject({ taskState: 'design_review', rounds: [{ name: DESIGN, content: designDoc }], ...over }));

const ok = (b: ReviewBinding | null): ReviewBinding => {
  assert.ok(b, 'expected a binding');
  return b;
};
const verdict = (b: ReviewBinding, id: string) => b.verdicts.find((v) => v.id === id);

// ── what counts as reviewable ──────────────────────────────────────────────────────────────────

test('the kind comes from the artifact, and only reviewable artifacts bind', () => {
  assert.equal(reviewKind('implementation-plan-v3.md'), 'plan');
  assert.equal(reviewKind('implementation-plan.md'), 'plan'); // legacy bare name is v1
  assert.equal(reviewKind('ship-plan-v2.md'), 'ship');
  assert.equal(reviewKind('design-mockup-v1-porch.html'), 'design');
  assert.equal(reviewKind('mockup.html', 'design'), 'design'); // the artifact KIND can say so too
  // a deliverable is not a review: it has no gate, so it stays an ordinary read-only file tab
  assert.equal(reviewKind('notes.md'), null);
  assert.equal(reviewKind('screenshot.png'), null);
  assert.equal(bindReview({ name: 'notes.md', content: 'hi' }, subject()), null);
});

// ── one component, three bindings ──────────────────────────────────────────────────────────────

test('all three kinds bind to the same shape — only the data differs', () => {
  const all = [ok(bindPlan()), ok(bindShip()), ok(bindDesign())];
  for (const b of all) {
    assert.equal(b.gate.state, 'open', `${b.kind} should be live at its own review state`);
    assert.ok(b.label, 'every kind names itself');
    assert.ok(b.gate.subject, 'every gate names what is being decided');
    assert.ok(b.modes.includes(b.defaultMode), 'the default mode is one of the offered modes');
    assert.deepEqual(b.verdicts.map((v) => v.id), ['approve', 'changes'], `${b.kind} offers the same two verdicts`);
  }
  // ...and the differences are DATA, not structure
  assert.deepEqual(all.map((b) => b.kind), ['plan', 'ship', 'design']);
  assert.deepEqual(all.map((b) => b.label), ['plan review', 'release plan', 'design review']);
  assert.deepEqual(all.map((b) => b.gate.subject), ['the plan', 'the release', 'the design']);
  assert.deepEqual(all.map((b) => verdict(b, 'approve')?.label), ['Approve plan', 'Approve release plan', 'Approve design']);
});

test('the gate says who may decide, and it is READ FROM THE FSM', () => {
  // approve_ship_plan and approve_design are `by: ['human']` in packages/shared — the tab shows a
  // human-only badge because the table says so, not because a reviewer remembered it.
  assert.equal(ok(bindShip()).gate.humanOnly, true);
  assert.equal(ok(bindDesign()).gate.humanOnly, true);
  // a plan's sign-off is not an FSM edge (approve_plan stamps the plan, the state stays), so it is
  // named beside the command schema — and the badge reads that list too
  assert.equal(ok(bindPlan()).gate.humanOnly, true);
  assert.equal(humanOnly('task.approve_plan'), true, 'named in HUMAN_ONLY_SIGN_OFFS, refused to every other actor by the handler');

  // the derivation, not a literal: flipping the table would flip the badge
  for (const [name, b] of [['approve_ship_plan', ok(bindShip())], ['approve_design', ok(bindDesign())]] as const) {
    const specs = TRANSITIONS.filter((t) => t.name === name);
    assert.ok(specs.length > 0, `${name} must exist in the FSM`);
    assert.equal(b.gate.humanOnly, specs.every((t) => t.by.length === 1 && t.by[0] === 'human'));
  }

  // The positive control this assertion needs to be worth anything: a command an AGENT may also
  // fire must report FALSE. Without it, `humanOnly` could `return true` and every case above still
  // passes, because a plan's approve command is null and never reaches the lookup.
  assert.equal(humanOnly('task.approve_ship_plan'), true);
  assert.equal(humanOnly('task.approve_design'), true);
  assert.equal(humanOnly('task.revise_plan'), false, 'revise_plan is by: [orchestrator, human]');
  assert.equal(humanOnly('task.revise_design'), false);
  assert.equal(humanOnly('task.claim'), false, 'an assignee claims — no badge');
  assert.equal(humanOnly('task.not_a_transition'), false, 'an unknown command is not a human-only one');
  assert.equal(humanOnly(null), false);
});

test('the mode segment belongs to the artifact — a design renders, a plan previews', () => {
  assert.deepEqual(ok(bindPlan()).modes, ['preview', 'source']);
  assert.equal(ok(bindPlan()).defaultMode, 'preview');
  assert.deepEqual(ok(bindDesign()).modes, ['rendered', 'source']);
  assert.equal(ok(bindDesign()).defaultMode, 'rendered');
});

test('a round with a predecessor offers a diff against it', () => {
  const b = ok(bindReview({ name: PLAN, content: planDoc, kind: 'doc' }, subject({
    rounds: [{ name: PLAN, content: planDoc }, { name: 'implementation-plan-v2.md', content: 'old' }],
  })));
  assert.deepEqual(b.modes, ['preview', 'source', 'diff']);
  assert.equal(b.diffAgainst?.name, 'implementation-plan-v2.md');
  assert.equal(b.diffLabel, 'Diff v2');
  // v1 has nothing to diff against
  assert.equal(ok(bindReview({ name: 'implementation-plan-v1.md', content: planDoc }, subject({
    taskState: 'plan_review', rounds: [{ name: 'implementation-plan-v1.md', content: planDoc }],
  }))).diffAgainst, null);
});

// ── the verdicts are the buttons ───────────────────────────────────────────────────────────────

test('approving a plan, a release and a design each fire their command; none posts a sentence in its place', () => {
  // until 2026-09-20 the plan's Approve posted the answer line of a retired question card: the
  // sentence woke rex, who answered it, and nothing approved. The command is the sign-off.
  const plan = verdict(ok(bindPlan()), 'approve');
  assert.equal(plan?.command, 'task.approve_plan');
  assert.equal(plan?.say, null);

  const ship = verdict(ok(bindShip()), 'approve');
  assert.equal(ship?.command, 'task.approve_ship_plan');
  assert.equal(ship?.say, null);

  const design = verdict(ok(bindDesign()), 'approve');
  assert.equal(design?.command, 'task.approve_design');
});

test('requesting changes spends the batch through the kind\'s own command', () => {
  assert.equal(verdict(ok(bindPlan()), 'changes')?.command, 'task.revise_plan');
  assert.equal(verdict(ok(bindShip()), 'changes')?.command, 'task.revise_ship_plan');
  assert.equal(verdict(ok(bindDesign()), 'changes')?.command, 'task.revise_design');
  for (const b of [ok(bindPlan()), ok(bindShip()), ok(bindDesign())]) {
    const v = verdict(b, 'changes')!;
    assert.equal(v.say, 'packet', 'the packet is posted to the thread as well as audited');
    assert.equal(v.needsComments, true, 'an empty batch cannot be spent');
    assert.equal(verdict(b, 'approve')!.needsComments, false);
  }
});

test('RULING 1 — approving closes the tab and returns to the conversation', () => {
  for (const b of [ok(bindPlan()), ok(bindShip()), ok(bindDesign())]) {
    assert.equal(verdict(b, 'approve')!.closes, true, `${b.kind}: the tab existed for a decision that no longer needs making`);
    assert.equal(verdict(b, 'changes')!.closes, true, `${b.kind}: a spent batch closes too — the round is gone`);
  }
});

// ── a settled round is a record, not a second live gate ────────────────────────────────────────

test('a superseded round opens read-only, with a door to the live one', () => {
  const b = ok(bindReview({ name: 'implementation-plan-v2.md', content: 'old' }, subject({
    rounds: [{ name: PLAN, content: planDoc }, { name: 'implementation-plan-v2.md', content: 'old' }],
  })));
  assert.equal(b.latest, false);
  assert.equal(b.gate.state, 'superseded');
  assert.deepEqual(b.verdicts, [], 'no approve buttons and no comment affordances on a stale round');
  assert.equal(b.openLatest, PLAN, 'the door to the round that is actually under review');
  assert.match(b.gate.note ?? '', /v3/);
});

test('a task past its gate shows the record, not the verdict', () => {
  const b = ok(bindPlan({ taskState: 'in_progress' }));
  assert.equal(b.gate.state, 'settled');
  assert.deepEqual(b.verdicts, []);
  assert.equal(b.openLatest, null, 'nothing newer to open — this IS the latest round');

  const ship = ok(bindShip({ taskState: 'verifying', approvedAt: '2026-07-31T10:00:00Z' }));
  assert.equal(ship.gate.state, 'settled');
  assert.match(ship.gate.note ?? '', /approved/i);
});

test('an unknown task state does not invent a live gate', () => {
  // no state at all: the tab still opens, and it opens WITHOUT a verdict rather than offering one
  // it cannot know is legal — the server would reject it and the human would have been lied to
  const b = ok(bindPlan({ taskState: null }));
  assert.equal(b.gate.state, 'settled');
  assert.deepEqual(b.verdicts, []);
});

// ── the batch ──────────────────────────────────────────────────────────────────────────────────

test('RULING 4 — the comment batch is a value, so a tab switch cannot lose it', () => {
  let cs: ReviewComment[] = [];
  cs = addComment(cs, { block: 2, text: 'say what happens when the repo is missing' });
  cs = addComment(cs, { block: 0, quote: 'green baseline before touching anything', text: 'which baseline?' });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs.map((c) => c.id), [1, 2], 'ids are stable and local to the batch');

  // an empty comment is not a comment
  assert.equal(addComment(cs, { block: 1, text: '   ' }).length, 2);

  cs = editComment(cs, 1, 'say what happens when the repo does not exist yet');
  assert.equal(cs[0]?.text, 'say what happens when the repo does not exist yet');
  assert.equal(editComment(cs, 99, 'nope'), cs, 'editing a comment that is gone is a no-op, by identity');

  cs = deleteComment(cs, 1);
  assert.deepEqual(cs.map((c) => c.id), [2]);
  assert.equal(deleteComment(cs, 99), cs);

  // and a fresh comment never reuses a spent id
  cs = addComment(cs, { block: 3, text: 'third' });
  assert.deepEqual(cs.map((c) => c.id), [2, 3]);
});

test('the packet keeps every marker the agents grep for', () => {
  const blocks = ['# Acme landing', 'Deliver the landing experience.', '## Steps', '1. Confirm repo & baseline.'];
  const cs: ReviewComment[] = [
    { id: 2, block: 3, text: 'second' },
    { id: 1, block: 1, quote: 'Deliver the landing experience.', text: 'first' },
  ];

  const plan = reviewPacket(ok(bindPlan()), cs, blocks);
  assert.match(plan, /^📝 Plan review — 2 comments on #1005:/);
  assert.ok(plan.indexOf('first') < plan.indexOf('second'), 'comments are ordered by block, not by when they were typed');
  assert.match(plan, /> Deliver the landing experience\.\n— first/);

  // the shipper reads its feedback from this exact phrase (agents.ts greps the message body)
  const ship = reviewPacket(ok(bindShip()), cs, blocks);
  assert.match(ship, /^📦 Release-plan changes requested on #1005:/);

  // designerFlow reads the round from this line
  const design = reviewPacket(ok(bindDesign()), cs, blocks);
  assert.match(design, /^🎨 Design changes requested on #1005 \(round 1\):/);

  // one comment is singular, and a quoted block is trimmed rather than dumped whole
  const one = reviewPacket(ok(bindPlan()), [{ id: 1, block: 0, text: 'x' }], ['#'.repeat(400)]);
  assert.match(one, /1 comment on/);
  assert.ok(!/ comments /.test(one));
  assert.ok(one.split('\n').every((l) => l.length <= 160), 'a 400-char block does not become a 400-char quote');
});

test('a comment with no quote falls back to its block, then to the block number', () => {
  const b = ok(bindPlan());
  assert.match(reviewPacket(b, [{ id: 1, block: 0, text: 'x' }], ['## Steps (ordered)']), /> Steps \(ordered\)\n— x/);
  assert.match(reviewPacket(b, [{ id: 1, block: 9, text: 'x' }], ['only one block']), /> block 10\n— x/);
});

// ── the diff mode ──────────────────────────────────────────────────────────────────────────────

test('diffRounds emits a unified diff the existing DiffView can parse', () => {
  const d = diffRounds('one\ntwo\nthree\n', 'one\nTWO\nthree\n', PLAN);
  assert.match(d, /^diff --git a\/implementation-plan-v3\.md b\/implementation-plan-v3\.md/);
  assert.match(d, /^@@ /m);
  assert.match(d, /^-two$/m);
  assert.match(d, /^\+TWO$/m);
  assert.match(d, /^ one$/m, 'context lines carry their leading space');

  // identical rounds produce no hunks rather than a fake one
  assert.equal(/^@@ /m.test(diffRounds('same\n', 'same\n', PLAN)), false);

  // an added tail and a removed head both land
  const grew = diffRounds('a\n', 'a\nb\n', PLAN);
  assert.match(grew, /^\+b$/m);
  const shrank = diffRounds('a\nb\n', 'b\n', PLAN);
  assert.match(shrank, /^-a$/m);
});
