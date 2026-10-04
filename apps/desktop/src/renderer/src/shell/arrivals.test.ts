// What opens by itself (shell/arrivals.ts), the side-panel round (2026-10-03). Run from apps/hq: pnpm test
//
// Three things hold: what a session showed while it settled never opens by itself · an old row that
// syncs late is not new (the positive control for the server-time floor) · a burst opens one tab in
// front, a gate first, and never in front of your unsaved work or through a fold you made mid-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideArrivals, EMPTY_FLOOR_MS, fileArrivalKind, noteRows, seenStart, serverMs, SETTLE_MS, type ArrivalKind } from './arrivals';

const T0 = Date.parse('2026-10-03T20:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const pgAt = (min: number) => at(min).replace('T', ' ').replace('Z', '+00');

test('server times read in both the Postgres text form and ISO; junk is null', () => {
  assert.equal(serverMs('2026-10-03 20:41:00.123+00'), Date.parse('2026-10-03T20:41:00.123Z'));
  assert.equal(serverMs('2026-10-03T20:41:00Z'), Date.parse('2026-10-03T20:41:00Z'));
  assert.equal(serverMs('2026-10-03 22:41:00+0200'), Date.parse('2026-10-03T20:41:00Z'));
  assert.equal(serverMs(null), null);
  assert.equal(serverMs('not a time'), null);
});

test('what a session showed while it settled never opens by itself', () => {
  const st = seenStart('task:T', T0);
  // the first deliveries: two rows from before the open
  assert.deepEqual(noteRows(st, [{ id: 'a', created_at: pgAt(-30) }, { id: 'b', created_at: pgAt(-5) }], T0 + 100), []);
  // another delivery, still settling, adds one more existing row
  assert.deepEqual(noteRows(st, [{ id: 'a', created_at: pgAt(-30) }, { id: 'c', created_at: pgAt(-2) }], T0 + 900), []);
  // after the window, a row the server made now is new, once
  const fresh = noteRows(st, [{ id: 'a', created_at: pgAt(-30) }, { id: 'd', created_at: pgAt(3) }], T0 + SETTLE_MS + 10);
  assert.deepEqual(fresh.map((r) => r.id), ['d']);
  assert.deepEqual(noteRows(st, [{ id: 'd', created_at: pgAt(3) }], T0 + SETTLE_MS + 500), [], 'each arrival is reported once');
});

test('an old row that syncs late is NOT new: the floor is the newest server time the session showed', () => {
  const st = seenStart('thread:H', T0);
  noteRows(st, [{ id: 'a', created_at: at(-1) }], T0 + 50);
  // a row from an hour ago arrives after the window (a slow sync): older than the floor
  assert.deepEqual(noteRows(st, [{ id: 'old', created_at: at(-60) }], T0 + 5_000), []);
  // positive control: the same shape with a time after the floor IS new
  assert.deepEqual(noteRows(st, [{ id: 'new', created_at: at(1) }], T0 + 5_000).map((r) => r.id), ['new']);
});

test('a session that showed nothing falls back to a floor two minutes before it opened', () => {
  const st = seenStart('thread:E', T0);
  noteRows(st, [], T0 + 10);
  assert.deepEqual(noteRows(st, [{ id: 'stale', created_at: new Date(T0 - EMPTY_FLOOR_MS - 1_000).toISOString() }], T0 + 4_000), []);
  assert.deepEqual(noteRows(st, [{ id: 'recent', created_at: new Date(T0 - 30_000).toISOString() }], T0 + 4_000).map((r) => r.id), ['recent']);
  assert.deepEqual(noteRows(st, [{ id: 'notime' }], T0 + 4_000), [], 'a row with no server time cannot prove it is new');
});

test('a produced file reads its kind from its name and its artifact kind', () => {
  assert.equal(fileArrivalKind('diff-1042.patch'), 'diff');
  assert.equal(fileArrivalKind('x', 'diff'), 'diff');
  assert.equal(fileArrivalKind('before-after.PNG'), 'image');
  assert.equal(fileArrivalKind('shot', 'screenshot'), 'image');
  assert.equal(fileArrivalKind('comparison-table.html'), 'page');
  assert.equal(fileArrivalKind('REPORT.md'), 'doc');
});

test('a burst opens ONE tab in front, a gate first; the rest wait behind it in the order they landed', () => {
  const a = (id: string, kind: ArrivalKind) => ({ id, kind });
  const d = decideArrivals([a('img', 'image'), a('rep', 'doc'), a('plan', 'gate'), a('tbl', 'doc')], { frontBusy: false, hold: false });
  assert.equal(d.front?.id, 'plan');
  assert.deepEqual(d.behind.map((x) => x.id), ['rep', 'tbl', 'img']);
  assert.equal(d.unfold, true);
  assert.deepEqual(decideArrivals([], { frontBusy: false, hold: false }), { front: null, behind: [], unfold: false });
});

test('never in front of your unsaved work, and never through a fold you made while an agent worked', () => {
  const list = [{ id: 'plan', kind: 'gate' as const }];
  const busy = decideArrivals(list, { frontBusy: true, hold: false });
  assert.equal(busy.front, null);
  assert.deepEqual(busy.behind.map((x) => x.id), ['plan'], 'it waits behind the busy tab, with its dot');
  const held = decideArrivals(list, { frontBusy: false, hold: true });
  assert.equal(held.front, null);
  assert.equal(held.unfold, false, 'the fold holds until the run ends');
  assert.deepEqual(held.behind.map((x) => x.id), ['plan'], 'it still joins the strip, and the panel button counts it');
});
