// Home's ledger: two groups, one narrowing, a cap. Run from apps/desktop:
// pnpm exec tsx --test src/renderer/src/shell/ledger.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_CAP, ledgerOf } from './ledger';
import type { ThreadStatus } from '@neuramesh/shared';

type R = { key: string; channelId: string | null; status: ThreadStatus };
const row = (key: string, status: ThreadStatus, channelId = 'c-dev'): R => ({ key, channelId, status });
const marksOf = (r: R) => ({ status: r.status, ask: r.status === 'needs_you', settle: r.status === 'needs_you' });
const projectOf = (id: string) => (id === 'c-mkt' ? 'p-mkt' : 'p-dev');
const rows = [row('a', 'needs_you'), row('b', 'in_progress'), row('c', 'settled'), row('d', 'needs_you', 'c-mkt'), row('e', 'settled', 'c-mkt')];
const keys = (xs: Array<{ r: R }>) => xs.map((x) => x.r.key);

test('unfiltered: the asks lead in their own group and Recent holds everything else, in order', () => {
  const l = ledgerOf({ rows, marksOf, status: null, projectId: null, projectOf });
  assert.deepEqual(keys(l.needs), ['a', 'd']);
  assert.deepEqual(keys(l.recent), ['b', 'c', 'e']);
  assert.deepEqual(l.counts, { all: 5, needs_you: 2, in_progress: 1, settled: 2 });
});

test('the needs-you word shows the queue alone; another word empties the queue and narrows Recent', () => {
  const ny = ledgerOf({ rows, marksOf, status: 'needs_you', projectId: null, projectOf });
  assert.deepEqual(keys(ny.needs), ['a', 'd']);
  assert.deepEqual(ny.recent, []);
  const settled = ledgerOf({ rows, marksOf, status: 'settled', projectId: null, projectOf });
  assert.deepEqual(settled.needs, []);
  assert.deepEqual(keys(settled.recent), ['c', 'e']);
});

test('a project narrows both groups AND the counts, so a chip can never disagree with its list', () => {
  const l = ledgerOf({ rows, marksOf, status: null, projectId: 'p-mkt', projectOf });
  assert.deepEqual(keys(l.needs), ['d']);
  assert.deepEqual(keys(l.recent), ['e']);
  assert.deepEqual(l.counts, { all: 2, needs_you: 1, in_progress: 0, settled: 1 });
  assert.equal(ledgerOf({ rows: [row('z', 'settled', null as unknown as string)], marksOf, status: null, projectId: 'p-dev', projectOf }).counts.all, 0, 'a row without a room is outside every project');
});

test('Recent is capped and says how many it held; the asks are never capped', () => {
  const many = Array.from({ length: LEDGER_CAP + 5 }, (_, i) => row(`r${i}`, 'settled'));
  const asks = Array.from({ length: 3 }, (_, i) => row(`n${i}`, 'needs_you'));
  const l = ledgerOf({ rows: [...asks, ...many], marksOf, status: null, projectId: null, projectOf });
  assert.equal(l.recent.length, LEDGER_CAP);
  assert.equal(l.recentTotal, LEDGER_CAP + 5);
  assert.equal(l.needs.length, 3);
  assert.equal(ledgerOf({ rows: many, marksOf, status: null, projectId: null, projectOf, cap: 2 }).recent.length, 2);
});

test('Show n more: a doubled cap shows the next step, and the remainder is what the control names', () => {
  const many = Array.from({ length: 95 }, (_, i) => row(`r${i}`, 'settled'));
  const first = ledgerOf({ rows: many, marksOf, status: null, projectId: null, projectOf });
  assert.equal(first.recentTotal - first.recent.length, 55, 'the control says how many rows the next steps hold');
  const second = ledgerOf({ rows: many, marksOf, status: null, projectId: null, projectOf, cap: LEDGER_CAP * 2 });
  assert.equal(second.recent.length, 80);
  assert.deepEqual(keys(second.recent).slice(0, 40), keys(first.recent), 'a step appends, it never reorders what was shown');
  const third = ledgerOf({ rows: many, marksOf, status: null, projectId: null, projectOf, cap: LEDGER_CAP * 3 });
  assert.equal(third.recent.length, 95);
  assert.equal(third.recentTotal - third.recent.length, 0, 'the last step retires the control');
});
