// P1 adoption (docs/harness/05). Run: pnpm exec tsx --test src/main/harness/hostqueue.test.ts
//
// The behaviour under test is the one the AgentHost has never had: five offers landing in one sync
// tick must not start five runtime CLIs. Everything else here guards the ways an admission gate can
// go wrong — over-admitting on a re-entrant drain, leaking a slot when a flow throws, and refusing
// work it should have run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostQueue, DurableSet, queueLine } from './hostqueue';
import { MemorySeenStore, triggerKey } from './dispatch';

/** A flow whose completion the test controls. */
function gate() {
  let release!: () => void;
  const done = new Promise<void>((r) => { release = r; });
  return { done, release };
}

const work = (key: string, agentId = 'a1') => ({ key, kind: 'work' as const, cause: 'board' as const, agentId });

test('the CEILING holds — five simultaneous offers do not all start', async () => {
  const q = new HostQueue({ caps: { slots: 2, perAgent: 2 } });
  const started: string[] = [];
  const gates = ['k1', 'k2', 'k3', 'k4', 'k5'].map((k) => {
    const g = gate();
    q.run(work(k, `agent-${k}`), async () => { started.push(k); await g.done; });
    return g;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(started.length, 2, 'exactly the slot count runs');
  assert.equal(q.stats().queued, 3, 'the rest wait rather than stampede');

  gates[0]!.release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(started.length, 3, 'a freed slot admits the next one');

  for (const g of gates) g.release();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(started.length, 5, 'everything eventually runs');
  assert.equal(q.stats().running, 0);
});

test('per-agent fairness — one busy agent cannot hold every slot', async () => {
  const q = new HostQueue({ caps: { slots: 3, perAgent: 1 } });
  const started: string[] = [];
  const g = gate();
  q.run(work('busy-1', 'busy'), async () => { started.push('busy-1'); await g.done; });
  q.run(work('busy-2', 'busy'), async () => { started.push('busy-2'); await g.done; });
  q.run(work('other-1', 'other'), async () => { started.push('other-1'); await g.done; });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started.sort(), ['busy-1', 'other-1'], 'the second busy job waits behind the fairness cap');
  g.release();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(started.includes('busy-2'));
});

test('a human-priority trigger jumps the queue ahead of board work', async () => {
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 } });
  const order: string[] = [];
  const hold = gate();
  q.run(work('holding', 'a0'), async () => { order.push('holding'); await hold.done; });
  await new Promise((r) => setImmediate(r));
  // queued while the slot is busy: board first, then a human message
  q.run({ key: 'board', kind: 'work', cause: 'board', agentId: 'a1' }, async () => { order.push('board'); });
  q.run({ key: 'human', kind: 'chat', cause: 'message', agentId: 'a2' }, async () => { order.push('human'); });
  hold.release();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(order, ['holding', 'human', 'board'], 'a person waiting wins, whatever arrived first');
});

test('a slot is RELEASED when a flow throws — a failure must not wedge the host', async () => {
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 } });
  const seen: string[] = [];
  q.run(work('boom'), async () => { seen.push('boom'); throw new Error('flow exploded'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q.stats().running, 0, 'the slot came back');
  q.run(work('after'), async () => { seen.push('after'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, ['boom', 'after']);
});

test('the same key is refused while queued, while running, and after settling', async () => {
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 } });
  let runs = 0;
  const g = gate();
  assert.equal(q.run(work('once'), async () => { runs += 1; await g.done; }), true);
  assert.equal(q.run(work('once'), async () => { runs += 1; }), false, 'refused while running');
  g.release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q.run(work('once'), async () => { runs += 1; }), false, 'refused after settling');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs, 1);
});

test('rearm makes a bounced task runnable again — the request_changes path, made explicit', async () => {
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 } });
  let runs = 0;
  q.run(work('t'), async () => { runs += 1; });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(q.run(work('t'), async () => { runs += 1; }), false);
  q.rearm('t');
  assert.equal(q.run(work('t'), async () => { runs += 1; }), true);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(runs, 2);
});

test('no over-admission under a re-entrant drain', async () => {
  // Every settle re-enters drain(); without the latch two drains each see the same free slot.
  const q = new HostQueue({ caps: { slots: 2, perAgent: 5 } });
  let concurrent = 0;
  let peak = 0;
  const jobs = Array.from({ length: 24 }, (_, i) => i);
  for (const i of jobs) {
    q.run(work(`j${i}`, 'same-agent-is-fine'), async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 1));
      concurrent -= 1;
    });
  }
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(peak, 2, `peak concurrency must equal the slot count, saw ${peak}`);
  assert.equal(q.stats().running, 0);
  assert.equal(q.stats().queued, 0, 'the queue drained fully');
});

test('boot recovery reports what this process was running', async () => {
  const q = new HostQueue({ caps: { slots: 2, perAgent: 2 } });
  const g = gate();
  q.run(work('a', 'x'), async () => { await g.done; });
  q.run(work('b', 'y'), async () => { await g.done; });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(q.resetRunning().sort(), ['a', 'b']);
  g.release();
});

test('queueLine reads as an operator would want it to', () => {
  const q = new HostQueue({ caps: { slots: 3, perAgent: 2 } });
  assert.match(queueLine(q), /queue: 0\/3 running, 0 waiting/);
});

// ── DurableSet: the already-handled facts ────────────────────────────────────────────────────
test('DurableSet keeps Set semantics so no call site changes', () => {
  const store = new MemorySeenStore();
  const merged = new DurableSet<string>(store, 'merged');
  assert.equal(merged.has('task-1'), false);
  merged.add('task-1');
  assert.equal(merged.has('task-1'), true);
  merged.delete('task-1');
  assert.equal(merged.has('task-1'), false);
});

test('DurableSet survives a "restart" on a shared store, and namespaces its keys', () => {
  const store = new MemorySeenStore();
  new DurableSet<string>(store, 'merged').add('task-9');
  // a fresh instance, as a restarted process would build
  assert.equal(new DurableSet<string>(store, 'merged').has('task-9'), true, 'a merge is not re-attempted after a restart');
  assert.equal(new DurableSet<string>(store, 'reclaimed').has('task-9'), false, 'different guards do not collide');
});

test('the review key rides the SHA, so a re-submission is genuinely new work', () => {
  const store = new MemorySeenStore();
  const reviewed = new DurableSet<string>(store, 'reviewed');
  reviewed.add(triggerKey.review('t1', 'sha-aaa'));
  assert.equal(reviewed.has(triggerKey.review('t1', 'sha-aaa')), true);
  assert.equal(reviewed.has(triggerKey.review('t1', 'sha-bbb')), false, 'a fresh submission earns a fresh review');
});

// ── The turn record: the settle discipline three flows never had ─────────────────────────────
test('every queued flow gets a guaranteed open/settle pair — including one that throws', async () => {
  const rec: string[] = [];
  const q = new HostQueue({
    caps: { slots: 1, perAgent: 1 },
    turns: {
      open: (w) => rec.push(`open:${w.key}`),
      settle: (w, state) => rec.push(`settle:${w.key}:${state}`),
    },
  });
  q.run(work('ok'), async () => { /* succeeds */ });
  await new Promise((r) => setTimeout(r, 20));
  q.run(work('boom'), async () => { throw new Error('flow exploded'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(rec, ['open:ok', 'settle:ok:done', 'open:boom', 'settle:boom:failed'],
    'executeFlow/claimFlow/resumeFlow have no finally of their own — the queue supplies it');
});

test('the failure reason reaches the record', async () => {
  let captured: unknown;
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 }, turns: { open: () => {}, settle: (_w, _s, err) => { captured = err; } } });
  q.run(work('why'), async () => { throw new Error('the actual cause'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.match((captured as Error).message, /the actual cause/);
});

test('a THROWING recorder never fails the turn — recording is not load-bearing', async () => {
  let ran = false;
  const q = new HostQueue({
    caps: { slots: 1, perAgent: 1 },
    turns: { open: () => { throw new Error('disk full'); }, settle: () => { throw new Error('disk full'); } },
  });
  q.run(work('resilient'), async () => { ran = true; });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(ran, true, 'the flow still ran');
  assert.equal(q.stats().running, 0, 'and the slot still came back');
});

test('two turns on the SAME subject share it — the defect that filed every message separately', () => {
  // The first implementation derived the subject from the trigger KEY, and a wake key is
  // `wake:<messageId>:<agentId>` — so every message got its own brain directory, which is the exact
  // opposite of a brain shared across a conversation's turns. The subject is now passed explicitly.
  const filed: string[] = [];
  const q = new HostQueue({
    caps: { slots: 2, perAgent: 2 },
    turns: { open: (w) => filed.push(JSON.stringify(w.subject)), settle: () => {} },
  });
  const subject = { kind: 'thread' as const, id: 'thread-abc' };
  q.run({ key: 'wake:msg-1:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject }, async () => {});
  q.run({ key: 'wake:msg-2:agent-1', kind: 'chat', cause: 'message', agentId: 'agent-1', subject }, async () => {});
  return new Promise((r) => setTimeout(r, 25)).then(() => {
    assert.equal(new Set(filed).size, 1, 'both turns file under ONE subject, whatever their keys');
    assert.deepEqual(JSON.parse(filed[0]!), subject);
  });
});

test('a turn with no subject still runs — it simply is not filed', async () => {
  let ran = false;
  const opened: unknown[] = [];
  const q = new HostQueue({ caps: { slots: 1, perAgent: 1 }, turns: { open: (w) => opened.push(w.subject), settle: () => {} } });
  q.run({ key: 'room-level', kind: 'triage', cause: 'board', agentId: 'orch' }, async () => { ran = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran, true, 'a room-level turn has no subject and must not be blocked by that');
  assert.deepEqual(opened, [undefined]);
});
