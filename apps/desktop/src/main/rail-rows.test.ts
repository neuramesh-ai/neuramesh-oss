// The rail's union watch (U3b, the source-release round): one subscription over every live
// connection the shell does NOT stand in, re-emitting when any of them changes and when a
// connection arrives or leaves. Pure — the sources are injected. Run from apps/desktop:
//   pnpm exec tsx --test src/main/rail-rows.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAIL_QUERIES, railRowsUnion, type RailQuery, type RailSource } from './sync/ipc/rail-rows';

/** a fake connection: every query is a hand-fed watch */
function fakeSource(id: string, kind: RailSource['kind'] = 'cloud') {
  const feeds = new Map<RailQuery, (rows: Array<Record<string, unknown>>) => void>();
  const aborted: RailQuery[] = [];
  const source: RailSource = {
    id, kind,
    watch: (q, onRows, signal) => {
      feeds.set(q, onRows);
      signal.addEventListener('abort', () => aborted.push(q));
    },
  };
  return { source, feed: (q: RailQuery, rows: Array<Record<string, unknown>>) => feeds.get(q)!(rows), aborted, watched: () => [...feeds.keys()] };
}
const tick = () => new Promise((r) => setImmediate(r));

test('every query of every source is watched, and rows arrive tagged with their connection', async () => {
  const a = fakeSource('cloud', 'cloud');
  const emits: Array<Record<string, unknown[]>> = [];
  const u = railRowsUnion({ sources: () => [a.source], emit: (p) => emits.push(p as unknown as Record<string, unknown[]>) });
  u.refresh();
  assert.deepEqual(a.watched().sort(), [...RAIL_QUERIES].sort());
  a.feed('threads', [{ id: 't1' }]);
  a.feed('tasks', [{ id: 'k1' }]);
  await tick();
  assert.equal(emits.length, 1, 'two results in one turn coalesce into one push');
  assert.deepEqual(emits[0]!['threads'], [{ id: 't1', connectionId: 'cloud', connectionKind: 'cloud' }]);
  assert.deepEqual(emits[0]!['tasks'], [{ id: 'k1', connectionId: 'cloud', connectionKind: 'cloud' }]);
  assert.deepEqual(emits[0]!['runs'], [], 'a query that has not answered yet is an empty slice, not a missing key');
  u.abort();
});

test('either connection\'s change re-emits the whole union', async () => {
  const a = fakeSource('cloud', 'cloud');
  const b = fakeSource('custom:x', 'custom');
  const emits: Array<Record<string, unknown[]>> = [];
  const u = railRowsUnion({ sources: () => [a.source, b.source], emit: (p) => emits.push(p as unknown as Record<string, unknown[]>) });
  u.refresh();
  a.feed('threads', [{ id: 'a1' }]);
  await tick();
  b.feed('threads', [{ id: 'b1' }]);
  await tick();
  assert.equal(emits.length, 2);
  assert.deepEqual(emits[1]!['threads']!.map((r) => (r as { id: string }).id), ['a1', 'b1']);
  a.feed('threads', [{ id: 'a1' }, { id: 'a2' }]);
  await tick();
  assert.deepEqual(emits[2]!['threads']!.map((r) => (r as { id: string }).id), ['a1', 'a2', 'b1'], 'a change on one side keeps the other side\'s rows');
  u.abort();
});

test('a connection added later is picked up on refresh; one removed is aborted and its rows leave the union', async () => {
  const a = fakeSource('cloud', 'cloud');
  const b = fakeSource('custom:x', 'custom');
  let live = [a.source];
  const emits: Array<Record<string, unknown[]>> = [];
  const u = railRowsUnion({ sources: () => live, emit: (p) => emits.push(p as unknown as Record<string, unknown[]>) });
  u.refresh();
  a.feed('threads', [{ id: 'a1' }]);
  await tick();
  live = [a.source, b.source];
  u.refresh();
  assert.deepEqual(b.watched().sort(), [...RAIL_QUERIES].sort(), 'the newcomer is watched');
  b.feed('threads', [{ id: 'b1' }]);
  await tick();
  assert.deepEqual(emits.at(-1)!['threads']!.map((r) => (r as { id: string }).id), ['a1', 'b1']);
  live = [b.source];
  u.refresh();
  await tick();
  assert.equal(a.aborted.length, RAIL_QUERIES.length, 'every watch of the removed connection is aborted');
  assert.deepEqual(emits.at(-1)!['threads']!.map((r) => (r as { id: string }).id), ['b1'], 'the removed connection\'s rows are gone');
  assert.equal(b.aborted.length, 0);
  u.abort();
  assert.equal(b.aborted.length, RAIL_QUERIES.length, 'abort() tears everything down');
});

test('a refresh that changes nothing emits nothing', async () => {
  const a = fakeSource('cloud', 'cloud');
  const emits: unknown[] = [];
  const u = railRowsUnion({ sources: () => [a.source], emit: (p) => emits.push(p) });
  u.refresh();
  a.feed('threads', []);
  await tick();
  const n = emits.length;
  u.refresh();
  await tick();
  assert.equal(emits.length, n);
  u.abort();
});
