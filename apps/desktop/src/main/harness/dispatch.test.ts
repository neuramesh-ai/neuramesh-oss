// The dispatcher (docs/harness/05). Run: pnpm exec tsx --test src/main/harness/dispatch.test.ts
//
// These are the tests the 25-watch arrangement could never have: priority, fairness, a concurrency
// ceiling, and dedupe that SURVIVES A RESTART. The last one is the point — the two bugs this replaces
// (the wake-vs-sweep double-triage race, the cross-process duplicate reply) were each "fixed" once
// with an in-memory Set and each came back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nextTurn, priorityOf, shedBacklog, defaultCaps, triggerKey,
  Dispatcher, MemorySeenStore, SqliteSeenStore, type Trigger, type Caps,
} from './dispatch';

const CAPS: Caps = { slots: 2, perAgent: 1 };
let n = 0;
const trig = (over: Partial<Trigger> = {}): Trigger => ({
  id: over.id ?? `t${n}`,
  kind: 'work',
  cause: 'board',
  agentId: 'a1',
  seq: n++,
  subject: {},
  ...over,
});

test('priority puts a human ahead of the board, and the board ahead of a sweep', () => {
  assert.equal(priorityOf({ cause: 'message', kind: 'chat' }), 1);
  assert.equal(priorityOf({ cause: 'park', kind: 'work' }), 2);
  assert.equal(priorityOf({ cause: 'board', kind: 'work' }), 2);
  assert.equal(priorityOf({ cause: 'spawn', kind: 'leg' }), 3);
  assert.equal(priorityOf({ cause: 'timer', kind: 'sweep' }), 4);
});

test('a human message is admitted before board work that arrived first', () => {
  n = 0;
  const board = trig({ id: 'board', cause: 'board' });
  const human = trig({ id: 'human', cause: 'message', kind: 'chat', agentId: 'a2' });
  const picked = nextTurn([board, human], [], CAPS, new Set());
  assert.equal(picked?.id, 'human', 'a person is waiting; arrival order must not win');
});

test('within one priority it is strict FIFO — admission is deterministic, never arrival-racy', () => {
  n = 0;
  const first = trig({ id: 'first' });
  const second = trig({ id: 'second', agentId: 'a2' });
  assert.equal(nextTurn([second, first], [], CAPS, new Set())?.id, 'first');
});

test('the slot cap holds — five offers in one tick do not start five runtime CLIs', () => {
  n = 0;
  const queue = [trig({ id: 'q1', agentId: 'a1' }), trig({ id: 'q2', agentId: 'a2' }), trig({ id: 'q3', agentId: 'a3' })];
  const running = [{ triggerId: 'r1', agentId: 'x', kind: 'work' as const }, { triggerId: 'r2', agentId: 'y', kind: 'work' as const }];
  assert.equal(nextTurn(queue, running, CAPS, new Set()), null, 'at the ceiling, nothing is admitted');
});

test('per-agent fairness stops one busy agent holding every slot', () => {
  n = 0;
  const caps: Caps = { slots: 4, perAgent: 1 };
  const queue = [trig({ id: 'busy2', agentId: 'busy' }), trig({ id: 'other', agentId: 'other' })];
  const running = [{ triggerId: 'busy1', agentId: 'busy', kind: 'work' as const }];
  assert.equal(nextTurn(queue, running, caps, new Set())?.id, 'other');
});

test('a seen key is never re-admitted, and neither is one already running', () => {
  n = 0;
  const t = trig({ id: 'dupe' });
  assert.equal(nextTurn([t], [], CAPS, new Set(['dupe'])), null);
  assert.equal(nextTurn([t], [{ triggerId: 'dupe', agentId: 'a1', kind: 'work' }], CAPS, new Set()), null);
});

test('defaultCaps derives slots from the machine and never returns zero', () => {
  assert.deepEqual(defaultCaps(8), { slots: 4, perAgent: 2 });
  assert.deepEqual(defaultCaps(4), { slots: 2, perAgent: 2 });
  assert.equal(defaultCaps(1).slots, 1, 'a single-core box still runs one turn');
  assert.equal(defaultCaps(64).slots, 4, 'capped — slots are memory-bound, not core-bound');
});

// ── Shedding ─────────────────────────────────────────────────────────────────────────────────
test('an overgrown queue sheds BACKGROUND work only, and reports what it dropped', () => {
  n = 0;
  const q = [
    trig({ id: 'human', cause: 'message', kind: 'chat' }),
    trig({ id: 'board', cause: 'board' }),
    trig({ id: 'sweep1', cause: 'timer', kind: 'sweep' }),
    trig({ id: 'sweep2', cause: 'timer', kind: 'sweep' }),
  ];
  const { keep, shed } = shedBacklog(q, 2);
  assert.deepEqual(keep.map((t) => t.id), ['human', 'board'], 'work anyone is waiting on is never shed');
  assert.deepEqual(shed.map((t) => t.id), ['sweep1', 'sweep2']);
});

test('a queue within its bound sheds nothing', () => {
  n = 0;
  const { shed } = shedBacklog([trig(), trig()], 8);
  assert.deepEqual(shed, []);
});

// ── Dedupe keys ──────────────────────────────────────────────────────────────────────────────
test('a re-submission earns a FRESH review — the key rides the SHA, not the task', () => {
  // The in-memory `reviewed` Set had to be cleared by a second watch to fix exactly this; keying on
  // the submitted SHA makes a re-review correct by construction instead of by a compensating watch.
  assert.notEqual(triggerKey.review('task-1', 'sha-aaa'), triggerKey.review('task-1', 'sha-bbb'));
  assert.equal(triggerKey.review('task-1', 'sha-aaa'), triggerKey.review('task-1', 'sha-aaa'));
});

test('a sweep key is floored, so clock jitter cannot fire it twice inside its window', () => {
  const every = 15 * 60_000;
  const base = 1_800_000_000_000;
  assert.equal(triggerKey.sweep('full', base, every), triggerKey.sweep('full', base + 60_000, every));
  assert.notEqual(triggerKey.sweep('full', base, every), triggerKey.sweep('full', base + every, every));
});

test('an offer key distinguishes state, so a task re-offered in a new phase is new work', () => {
  assert.notEqual(triggerKey.offer('t', 'todo', 'a'), triggerKey.offer('t', 'plan_review', 'a'));
});

// ── The Dispatcher ───────────────────────────────────────────────────────────────────────────
test('offer → admit → settle accounts correctly, and a settled key does not re-admit', () => {
  const seen = new MemorySeenStore();
  const d = new Dispatcher(seen, { slots: 2, perAgent: 2 });
  assert.equal(d.offer({ id: 'k1', kind: 'work', cause: 'board', agentId: 'a1', subject: {} }), true);
  assert.equal(d.offer({ id: 'k1', kind: 'work', cause: 'board', agentId: 'a1', subject: {} }), false, 'the same key is refused while queued');
  const t = d.admit();
  assert.equal(t?.id, 'k1');
  assert.equal(d.stats().running, 1);
  d.settle('k1', 'done');
  assert.equal(d.stats().running, 0);
  assert.equal(d.offer({ id: 'k1', kind: 'work', cause: 'board', agentId: 'a1', subject: {} }), false, 'a settled key is durably refused');
});

test('rearm releases a key on purpose — the review bounce, made explicit', () => {
  const seen = new MemorySeenStore();
  const d = new Dispatcher(seen, { slots: 1, perAgent: 1 });
  d.offer({ id: 'k', kind: 'review', cause: 'board', agentId: 'r', subject: {} });
  d.settle(d.admit()!.id, 'done');
  d.rearm('k');
  assert.equal(d.offer({ id: 'k', kind: 'review', cause: 'board', agentId: 'r', subject: {} }), true);
});

test('a crash leaves no phantom running turns', () => {
  const d = new Dispatcher(new MemorySeenStore(), { slots: 2, perAgent: 2 });
  d.offer({ id: 'a', kind: 'work', cause: 'board', agentId: 'a1', subject: {} });
  d.offer({ id: 'b', kind: 'work', cause: 'board', agentId: 'a2', subject: {} });
  d.admit(); d.admit();
  assert.equal(d.stats().running, 2);
  const orphans = d.resetRunning();
  assert.equal(orphans.length, 2, 'the caller settles these as stopped — nothing this process owns still runs');
  assert.equal(d.stats().running, 0);
});

test('shedding is surfaced to the caller, never swallowed', () => {
  const shedSeen: string[] = [];
  const d = new Dispatcher(new MemorySeenStore(), { slots: 1, perAgent: 1 }, { maxQueue: 2, onShed: (s) => shedSeen.push(...s.map((x) => x.id)) });
  for (const id of ['s1', 's2', 's3', 's4']) d.offer({ id, kind: 'sweep', cause: 'timer', agentId: 'orch', subject: {} });
  assert.ok(shedSeen.length > 0, 'the drop is reported');
  assert.equal(d.stats().shed, shedSeen.length);
});

// ── Durability: the whole reason this exists ─────────────────────────────────────────────────
// better-sqlite3 in this repo is rebuilt against ELECTRON's ABI (`pnpm rebuild:native`), so plain
// `tsx --test` cannot load it. The SQLite adapter is therefore exercised under Electron; here we skip
// it LOUDLY with the reason rather than deleting the test or pretending it ran — and the durability
// CONTRACT (that the Dispatcher consults the store, not process state) is proven below without it.
const sqliteUsable = (() => {
  try { new SqliteSeenStore(join(mkdtempSync(join(tmpdir(), 'nm-abi-')), 'probe.db')).close(); return true; }
  catch { return false; }
})();
const sqliteSkip = sqliteUsable ? false : 'better-sqlite3 is built for Electron\'s ABI — run under Electron';

test('DURABLE (contract) — a second Dispatcher on the same store refuses a handled key', () => {
  // This is the property the in-memory Sets lacked, tested independently of the storage engine: a
  // FRESH Dispatcher — as a restarted process would build — must consult the store and stand down.
  const shared = new MemorySeenStore();
  const first = new Dispatcher(shared, { slots: 1, perAgent: 1 });
  first.offer({ id: 'wake:msg-1:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject: {} });
  first.settle(first.admit()!.id, 'done');

  const restarted = new Dispatcher(shared, { slots: 1, perAgent: 1 });
  assert.equal(
    restarted.offer({ id: 'wake:msg-1:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject: {} }),
    false,
    'the duplicate reply an in-memory Set could not see is refused by a new process',
  );
  assert.equal(restarted.admit(), null);
});

test('DURABLE — dedupe survives a process restart (SQLite store)', { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-dispatch-'));
  const path = join(dir, 'harness.db');
  try {
    const s1 = new SqliteSeenStore(path);
    const d1 = new Dispatcher(s1, { slots: 1, perAgent: 1 });
    d1.offer({ id: 'wake:msg-1:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject: {} });
    d1.settle(d1.admit()!.id, 'done');
    s1.close();

    // …the process dies here. A new one starts, with a fresh in-memory everything.
    const s2 = new SqliteSeenStore(path);
    const d2 = new Dispatcher(s2, { slots: 1, perAgent: 1 });
    assert.equal(
      d2.offer({ id: 'wake:msg-1:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject: {} }),
      false,
      'the duplicate reply an in-memory Set could not see is refused across processes',
    );
    assert.equal(d2.admit(), null);
    s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the store prunes by age, so an ancient key cannot pin memory forever', () => {
  let now = 1_000_000;
  const s = new MemorySeenStore(() => now);
  s.mark('old', 'done');
  now += 10 * 86_400_000;
  s.mark('fresh', 'done');
  assert.equal(s.prune(7 * 86_400_000), 1);
  assert.equal(s.has('old'), false);
  assert.equal(s.has('fresh'), true);
});

test('SQLite prune and clear behave like the memory store', { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-dispatch-prune-'));
  try {
    let now = 1_000_000;
    const s = new SqliteSeenStore(join(dir, 'h.db'), () => now);
    s.mark('a', 'done');
    now += 10 * 86_400_000;
    s.mark('b', 'failed');
    assert.equal(s.prune(7 * 86_400_000), 1);
    assert.deepEqual([...s.snapshot()], ['b']);
    s.clear('b');
    assert.equal(s.has('b'), false);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
