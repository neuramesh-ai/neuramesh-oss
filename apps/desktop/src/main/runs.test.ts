// Runs (docs/29): the pure parts — how an activity stream is rationed into a synced `step`
// line, and how a deep-work fan-out is normalized before anything is opened.
// Run from apps/desktop: pnpm exec tsx --test src/main/runs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNarrator, normalizeLegs, fanoutStep, mapCapped, MAX_LEGS, STEP_MIN_MS } from './runs';
import { runFraction, runElapsed, isRunStale, runLine, toolVerb } from '@neuramesh/shared';

const call = (summary: string) => ({ kind: 'tool', phase: 'call' as string | null, summary });

test('the narrator speaks the first verb immediately', () => {
  const n = makeNarrator();
  assert.equal(n.next(call('Read src/session/timer.ts'), 1_000), 'reading timer.ts');
});

test('a tool burst is rationed — a status line nobody can read is a write storm, not progress', () => {
  const n = makeNarrator();
  assert.equal(n.next(call('Read a.ts'), 0), 'reading a.ts');
  // the SDK fires these ~100ms apart; every one of them would be a server write
  assert.equal(n.next(call('Read b.ts'), 100), null);
  assert.equal(n.next(call('Read c.ts'), 900), null);
  assert.equal(n.next(call('Read d.ts'), STEP_MIN_MS), 'reading d.ts');
});

test('the same words twice is not news', () => {
  const n = makeNarrator(0);
  assert.equal(n.next(call('WebSearch flowe reviews'), 0), 'searching “flowe reviews”');
  assert.equal(n.next(call('WebSearch flowe reviews'), 10_000), null);
  assert.equal(n.next(call('WebSearch flowe pricing'), 20_000), 'searching “flowe pricing”');
});

test('rows worth no words produce no write', () => {
  const n = makeNarrator(0);
  assert.equal(n.next({ kind: 'tool', phase: 'result', summary: 'Read a.ts' }, 0), null);
  assert.equal(n.next({ kind: 'result', phase: null, summary: 'replied (400 tok)' }, 0), null);
});

test('no identifier ever reaches the step line (the docs/26 rule, now synced)', () => {
  assert.equal(toolVerb(call('nm.task_status'))?.verb, 'checking the board');
  assert.equal(toolVerb(call('nm.some_new_tool'))?.verb, 'some new tool');
  assert.equal(toolVerb(call('mcp__github__list_prs'))?.verb, 'github: list prs');
});

test('normalizeLegs trims, drops the unusable, dedupes by name, and caps', () => {
  const legs = normalizeLegs([
    { name: '  user reviews & complaints  ', prompt: 'find what users complain about' },
    { name: 'user reviews & complaints', prompt: 'a duplicate angle' },   // same name → dropped
    { name: 'no prompt' },                                                 // unusable → dropped
    { prompt: 'no name' },                                                 // unusable → dropped
    ...Array.from({ length: 9 }, (_, i) => ({ name: `angle ${i}`, prompt: `look into ${i}` })),
  ]);
  assert.equal(legs[0]!.name, 'user reviews & complaints');
  assert.equal(legs.length, MAX_LEGS);
});

test('the parent step names the live legs, then the synthesis', () => {
  assert.equal(fanoutStep(0, 3, []), 'starting the legs');
  assert.equal(fanoutStep(1, 3, ['reviews']), 'reviews');
  assert.equal(fanoutStep(0, 4, ['a', 'b', 'c']), 'a · b +1');
  assert.equal(fanoutStep(3, 3, []), 'synthesizing the report');
});

test('mapCapped runs everything, caps concurrency, and keeps input order', async () => {
  let live = 0;
  let peak = 0;
  const out = await mapCapped([1, 2, 3, 4, 5, 6], 2, async (n) => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
  assert.ok(peak <= 2, `concurrency peaked at ${peak}`);
});

test('the ring never reads empty while work is live, nor full before it settles', () => {
  assert.equal(runFraction({ state: 'running', done: 0, total: 0 }), 0.08); // indeterminate
  assert.equal(runFraction({ state: 'running', done: 0, total: 5 }), 0.08); // started, nothing done
  assert.equal(runFraction({ state: 'running', done: 5, total: 5 }), 0.97); // done ≠ settled
  assert.equal(runFraction({ state: 'done', done: 0, total: 5 }), 1);
});

test('elapsed is the app clock, and freezes at what the work TOOK once settled', () => {
  const startedAt = '2026-07-25T10:00:00.000Z';
  assert.equal(runElapsed({ startedAt, endedAt: null }, Date.parse('2026-07-25T10:00:07.000Z')), '0:07');
  assert.equal(runElapsed({ startedAt, endedAt: '2026-07-25T10:06:12.000Z' }, Date.parse('2026-07-25T23:00:00.000Z')), '6:12');
  assert.equal(runElapsed({ startedAt, endedAt: '2026-07-25T11:12:40.000Z' }), '1:12:40');
});

test('a run whose host died goes stale — the watchdog\'s handle on an eternal spinner', () => {
  const now = Date.parse('2026-07-25T12:00:00.000Z');
  assert.equal(isRunStale({ state: 'running', updatedAt: '2026-07-25T11:59:00.000Z' }, now), false);
  assert.equal(isRunStale({ state: 'running', updatedAt: '2026-07-25T11:00:00.000Z' }, now), true);
  assert.equal(isRunStale({ state: 'done', updatedAt: '2026-07-25T09:00:00.000Z' }, now), false);
});

test('the one-line status prefers the live step, then falls back to something true', () => {
  const base = { title: 'Research: how to improve Flowe', done: 1, total: 3 };
  assert.equal(runLine({ ...base, state: 'running', step: 'reading g2.com', summary: null }), 'reading g2.com');
  assert.equal(runLine({ ...base, state: 'running', step: null, summary: null }), 'Research: how to improve Flowe');
  assert.equal(runLine({ ...base, state: 'done', step: 'stale', summary: '3 angles · report posted' }), '3 angles · report posted');
  assert.equal(runLine({ ...base, state: 'stopped', step: null, summary: null }), 'Research: how to improve Flowe — stopped');
});
