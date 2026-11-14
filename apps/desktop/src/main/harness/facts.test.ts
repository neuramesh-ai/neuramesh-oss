// The fact stores (facts.ts) and the Cloud Run guard store's wiring (hostqueue.ts, host/guards.ts).
// Run: pnpm exec tsx --test src/main/harness/facts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySeenStore } from './dispatch';
import { ApiFactStore, DurableCountMap, DurableStringSet, FactSeenStore, SqliteFactStore, splitKey, type Fact, type FactStore } from './facts';
import { DurableSet, durableStore, isSharedFacts, prepareDurableFacts, useSharedFacts } from './hostqueue';
import { makeHostGuards } from '../host/guards';
import { EpochFencedError, MachineTokenRejected } from '../cloudrun/snapshot';

/** an in-memory stand-in for control-api's machine_facts: insert-if-absent, the writer's own release */
class FakeShared implements FactStore {
  readonly scope = 'shared' as const;
  rows = new Map<string, Fact>();
  calls: string[] = [];
  failNext = 0;
  fence = false;
  private k = (kind: string, subject: string) => `${kind}|${subject}`;
  private guard(): void {
    if (this.fence) throw new EpochFencedError('stale epoch');
    if (this.failNext > 0) { this.failNext -= 1; throw new Error('HTTP 503'); }
  }
  async record(kind: string, subject: string) {
    this.calls.push(`record ${kind} ${subject}`);
    this.guard();
    const had = this.rows.get(this.k(kind, subject));
    if (had) return { created: false, fact: had };
    const fact: Fact = { kind, subject, payload: {}, createdAt: new Date().toISOString(), createdByMachine: 'm1', epoch: 1 };
    this.rows.set(this.k(kind, subject), fact);
    return { created: true, fact };
  }
  async get(kind: string, subject: string) { return this.rows.get(this.k(kind, subject)) ?? null; }
  async list(kind: string) { return [...this.rows.values()].filter((f) => f.kind === kind); }
  async release(kind: string, subject: string) {
    this.calls.push(`release ${kind} ${subject}`);
    this.guard();
    return this.rows.delete(this.k(kind, subject));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 5));
const fast = { sleep: async () => {} };

test('splitKey reads DurableSet\'s layout; a key with no kind is a plain seen key', () => {
  assert.deepEqual(splitKey('merged:task-1'), { kind: 'merged', subject: 'task-1' });
  assert.deepEqual(splitKey('wake-gave-up:m1:2'), { kind: 'wake-gave-up', subject: 'm1:2' });
  assert.deepEqual(splitKey('review:abc'), { kind: 'review', subject: 'abc' });
  assert.deepEqual(splitKey('Weird Key'), { kind: 'seen', subject: 'Weird Key' });
});

test('SqliteFactStore: insert-if-absent over the harness.db keys a DurableSet already wrote', async () => {
  const seen = new MemorySeenStore();
  new DurableSet<string>(seen, 'merged').add('task-1'); // written by today's daemon
  const facts = new SqliteFactStore(seen);
  assert.equal((await facts.record('merged', 'task-1')).created, false, 'the old fact reads as handled');
  assert.equal((await facts.record('merged', 'task-2')).created, true);
  assert.equal((await facts.record('merged', 'task-2')).created, false);
  assert.deepEqual((await facts.list('merged')).map((f) => f.subject).sort(), ['task-1', 'task-2']);
  assert.equal(await facts.release('merged', 'task-2'), true);
  assert.equal(await facts.get('merged', 'task-2'), null);
  assert.equal(facts.scope, 'local');
});

test('ApiFactStore: every write names the epoch; 409 fences and 401 is a refused token', async () => {
  const sent: Array<{ url: string; method: string; body: unknown; auth: string | undefined }> = [];
  let status = 201;
  let reply: unknown = { created: true, fact: { kind: 'merged', subject: 's' } };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>)['authorization'] });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  let epoch = 4;
  const api = new ApiFactStore({ apiUrl: 'https://api.test', headers: async () => ({ authorization: 'Bearer nmm_x' }), epoch: () => epoch, fetchImpl });
  assert.equal((await api.record('merged', 's', { pr: 1 })).created, true);
  assert.deepEqual(sent[0], { url: 'https://api.test/v1/machines/facts', method: 'POST', body: { epoch: 4, kind: 'merged', subject: 's', payload: { pr: 1 } }, auth: 'Bearer nmm_x' });
  status = 200; reply = { fact: null };
  assert.equal(await api.get('merged', 'a b'), null);
  assert.equal(sent[1]!.url, 'https://api.test/v1/machines/facts?kind=merged&subject=a+b');
  reply = { facts: [] };
  await api.list('merged', new Date('2026-10-20T00:00:00Z'));
  assert.equal(sent[2]!.url, 'https://api.test/v1/machines/facts?kind=merged&since=2026-10-20T00%3A00%3A00.000Z');
  epoch = 5; reply = { released: true };
  assert.equal(await api.release('merged', 's'), true);
  assert.deepEqual(sent[3]!.body, { epoch: 5, kind: 'merged', subject: 's' });
  status = 409; reply = { error: 'epoch 5 is behind 6', code: 'STALE_EPOCH' };
  await assert.rejects(api.record('merged', 's'), EpochFencedError);
  status = 401;
  await assert.rejects(api.record('merged', 's'), MachineTokenRejected);
});

test('FactSeenStore: reads stay local and synchronous; writes reach the shared store in order per key', async () => {
  const remote = new FakeShared();
  const store = new FactSeenStore(new MemorySeenStore(), remote, fast);
  const merged = new DurableSet<string>(store, 'merged');
  merged.add('task-1');
  assert.equal(merged.has('task-1'), true, 'the read is the local cache, at once');
  merged.delete('task-1'); // a failed merge releases its guard right after
  await store.flush();
  assert.deepEqual(remote.calls, ['record merged task-1', 'release merged task-1'], 'an add then a delete lands as a delete');
  assert.equal(remote.rows.size, 0);
  assert.equal(store.pending, 0);
});

test('FactSeenStore: a machine-scoped kind is keyed by machine, and hydration skips other machines\' facts', async () => {
  const remote = new FakeShared();
  const opts = { ...fast, machineScoped: new Set(['reclaimed']), machineId: 'm1' };
  const a = new FactSeenStore(new MemorySeenStore(), remote, opts);
  new DurableSet<number>(a, 'reclaimed').add(42);
  new DurableSet<string>(a, 'merged').add('task-9');
  await a.flush();
  assert.ok(remote.rows.has('reclaimed|m1/42'));
  assert.ok(remote.rows.has('merged|task-9'));
  await remote.record('reclaimed', 'm2/7'); // another machine's worktree
  // THE CRASH: the local cache is gone (or rolled back to an older snapshot). Hydration restores it.
  const b = new FactSeenStore(new MemorySeenStore(), remote, opts);
  assert.equal(await b.hydrate(['merged', 'reclaimed']), 2);
  assert.equal(new DurableSet<number>(b, 'reclaimed').has(42), true);
  assert.equal(new DurableSet<number>(b, 'reclaimed').has(7), false, 'm2\'s worktree is not this machine\'s');
  assert.equal(new DurableSet<string>(b, 'merged').has('task-9'), true, 'a merge another epoch did is not repeated');
});

test('FactSeenStore.claim: the shared insert decides, across epochs', async () => {
  const remote = new FakeShared();
  const first = new FactSeenStore(new MemorySeenStore(), remote, fast);
  assert.equal(await first.claim('merged:task-3'), true, 'the first claimer acts');
  const restarted = new FactSeenStore(new MemorySeenStore(), remote, fast);
  assert.equal(await restarted.claim('merged:task-3'), false, 'a restarted process never acts twice');
  assert.equal(restarted.has('merged:task-3'), true);
});

test('FactSeenStore: a transient failure retries; a fence stops every later write', async () => {
  const remote = new FakeShared();
  const logs: string[] = [];
  const store = new FactSeenStore(new MemorySeenStore(), remote, { ...fast, log: (l) => logs.push(l) });
  remote.failNext = 2;
  store.mark('merged:a', 'done');
  await store.flush();
  assert.ok(remote.rows.has('merged|a'), 'two 503s, then the write landed');
  remote.fence = true;
  store.mark('merged:b', 'done');
  await store.flush();
  assert.equal(store.fenced, true);
  remote.fence = false;
  store.mark('merged:c', 'done');
  await store.flush();
  assert.ok(!remote.rows.has('merged|c'), 'a fenced process writes nothing more');
  assert.ok(store.has('merged:c'), 'its local guard still holds');
  assert.ok(logs.some((l) => l.includes('shared writes stopped')));
});

test('DurableStringSet and DurableCountMap survive a restart over the same store, and keep their types', () => {
  const seen = new MemorySeenStore();
  const hires: Set<string> = new DurableStringSet(seen, 'hire-proposed');
  hires.add('task-1');
  const gaveUp: Map<string, number> = new DurableCountMap(seen, 'wake-gave-up');
  gaveUp.set('msg-1', (gaveUp.get('msg-1') ?? 0) + 1);
  gaveUp.set('msg-1', (gaveUp.get('msg-1') ?? 0) + 1);
  // the next process
  const hires2 = new DurableStringSet(seen, 'hire-proposed');
  assert.equal(hires2.has('task-1'), true);
  assert.equal(hires2.has('task-2'), false);
  const gaveUp2 = new DurableCountMap(seen, 'wake-gave-up');
  assert.equal(gaveUp2.get('msg-1'), 2, 'the bounded retries are not spent again after a wake');
  assert.equal(gaveUp2.get('msg-2'), undefined);
  gaveUp2.clear(); // the memory bound only
  assert.equal(gaveUp2.get('msg-1'), 2);
  hires2.delete('task-1');
  assert.equal(new DurableStringSet(seen, 'hire-proposed').has('task-1'), false);
});

test('Cloud Run wiring: prepareDurableFacts hydrates BEFORE the host, durableStore hands that store over, and the guards turn durable', async () => {
  const remote = new FakeShared();
  await remote.record('merged', 'task-77');
  await remote.record('hire-proposed', 'task-5');
  const root = mkdtempSync(join(tmpdir(), 'nm-facts-'));
  useSharedFacts(remote, 'm1');
  try {
    const prepared = await prepareDurableFacts(root, () => {});
    assert.ok(prepared);
    const store = durableStore(root);
    assert.equal(store, prepared, 'the host gets the hydrated store, not a cold one');
    assert.equal(isSharedFacts(store), true);
    const guards = makeHostGuards(store);
    assert.equal(guards.merged.has('task-77'), true, 'a merge a previous epoch recorded');
    assert.equal(guards.hireProposed.has('task-5'), true, 'a hire card is posted once per task, not once per wake');
    assert.ok(guards.hireProposed instanceof DurableStringSet);
    assert.ok(guards.wakeGaveUp instanceof DurableCountMap);
    guards.merged.add('task-78');
    await prepared.flush();
    assert.ok(remote.rows.has('merged|task-78'));
    await settle();
  } finally {
    useSharedFacts(null);
  }
  // unset: the desktop's store and its plain in-memory guards, exactly as before
  const local = durableStore(mkdtempSync(join(tmpdir(), 'nm-facts-')));
  assert.equal(isSharedFacts(local), false);
  const guards = makeHostGuards(local);
  assert.ok(!(guards.hireProposed instanceof DurableStringSet));
  assert.ok(!(guards.wakeGaveUp instanceof DurableCountMap));
});
