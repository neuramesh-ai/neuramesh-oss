// The upgrade handoff: the fifteen-minute poll and its four exits, and the completion order.
// Run from apps/desktop:  pnpm exec tsx --test src/main/upgrade.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPGRADE_WAIT_MS, finishUpgrade, pollDesktopAuth, proPageUrl, startDesktopAuth, waitForPlan, type HandoffSession, type PollDeps } from './upgrade';
import type { ConnectionSpec } from './connections';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const START = { nonce: 'n1', pollSecret: 's1' };

/** a fake clock the poll's sleep advances — a 15-minute wait runs in microseconds */
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

function poll(answers: Array<unknown | Error>, over: Partial<PollDeps> | ((calls: string[]) => Partial<PollDeps>) = {}) {
  const c = clock();
  const t0 = c.now();
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body)) as { nonce: string; pollSecret: string };
    assert.deepEqual(body, START, 'every poll carries the nonce and the secret');
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    return json(a);
  };
  const extra = typeof over === 'function' ? over(calls) : over;
  return { run: pollDesktopAuth({ fetchImpl, apiUrl: 'https://api.example', start: START, sleep: c.sleep, now: c.now, cancelled: () => false, ...extra }), calls, c, t0 };
}

test('proPageUrl: the sign-up face of /pro on the connection web url, with the nonce', () => {
  assert.equal(proPageUrl('https://neuramesh.app', 'abc'), 'https://neuramesh.app/pro?nonce=abc&mode=signup');
  assert.equal(proPageUrl('http://localhost:5173/', 'x y'), 'http://localhost:5173/pro?nonce=x+y&mode=signup');
});

test('startDesktopAuth: the nonce and the secret, or a loud failure', async () => {
  const ok = await startDesktopAuth(async () => json({ nonce: 'n', pollSecret: 's', expiresIn: 900 }), 'https://api.example');
  assert.deepEqual(ok, { nonce: 'n', pollSecret: 's' });
  await assert.rejects(startDesktopAuth(async () => json({ error: 'nope' }, 503), 'https://api.example'), /did not start \(503\)/);
  await assert.rejects(startDesktopAuth(async () => json({}), 'https://api.example'), /did not start/);
});

test('the poll stops on done with the session the page landed', async () => {
  const { run, calls } = poll([{ status: 'pending' }, { status: 'pending' }, { status: 'done', userId: 'u1', email: 'dana@vertex.dev', sessionId: 'sess_1' }]);
  assert.deepEqual(await run, { status: 'done', session: { userId: 'u1', email: 'dana@vertex.dev', sessionId: 'sess_1' } });
  assert.equal(calls.length, 3);
});

test('the poll stops on gone — the server expired the nonce', async () => {
  const { run, calls } = poll([{ status: 'pending' }, { status: 'gone' }]);
  assert.deepEqual(await run, { status: 'expired' });
  assert.equal(calls.length, 2);
});

test('the poll stops on cancel before it asks again', async () => {
  // the sheet's Cancel lands after the second round: the third must never reach the server
  const { run, calls } = poll([{ status: 'pending' }], (calls) => ({ cancelled: () => calls.length >= 2 }));
  assert.deepEqual(await run, { status: 'cancelled' });
  assert.equal(calls.length, 2);
});

test('the poll runs fifteen minutes on pending, then times out — not sixty seconds', async () => {
  const { run, calls, c, t0 } = poll([{ status: 'pending' }]);
  assert.deepEqual(await run, { status: 'timeout' });
  const waited = c.now() - t0;
  assert.ok(waited >= UPGRADE_WAIT_MS && waited < UPGRADE_WAIT_MS + 2000, `waited ${waited}ms`);
  assert.equal(UPGRADE_WAIT_MS, 15 * 60_000);
  assert.ok(calls.length >= 590 && calls.length <= 600, `about one poll per 1.5s for 15 minutes, saw ${calls.length}`);
});

test('a network blip is not an answer — the poll keeps going and lands the later done', async () => {
  const { run } = poll([new Error('ECONNRESET'), { status: 'done', userId: 'u2', email: '', sessionId: '' }]);
  assert.equal((await run).status, 'done');
});

test('waitForPlan: true the moment the row reads cloud, false once the wait runs out', async () => {
  const c = clock();
  let reads = 0;
  const plan = async () => (++reads >= 3 ? 'cloud' : 'free');
  assert.equal(await waitForPlan({ plan, sleep: c.sleep, now: c.now, timeoutMs: 60_000 }), true);
  assert.equal(reads, 3);
  const t0 = c.now();
  assert.equal(await waitForPlan({ plan: async () => 'free', sleep: c.sleep, now: c.now, timeoutMs: 10_000, everyMs: 1000 }), false);
  assert.ok(c.now() - t0 >= 10_000);
  // a failed read is "not yet", never a throw out of the landing
  assert.equal(await waitForPlan({ plan: async () => { throw new Error('offline'); }, sleep: c.sleep, now: c.now, timeoutMs: 2000, everyMs: 1000 }), false);
});

const SPEC: ConnectionSpec = { id: 'cloud', kind: 'cloud', authMode: 'clerk', apiUrl: 'https://api.example', powersyncUrl: 'https://ps.example', webUrl: 'https://neuramesh.app' };
const SESSION: HandoffSession = { userId: 'u1', email: 'dana@vertex.dev', sessionId: 'sess_1' };

test('completion: the session is saved first, the cloud connection is added, the plan is awaited, then the foreground swaps', async () => {
  const c = clock();
  const order: string[] = [];
  let plan = 'free';
  const conn = { id: 'cloud', ws: 'ws1' };
  const out = await finishUpgrade(SESSION, {
    saveSession: (s) => { order.push(`save:${s.userId}`); },
    existing: () => undefined,
    addConnection: async (spec) => { order.push(`add:${spec.id}:${spec.kind}:${spec.authMode}`); assert.equal(spec, SPEC); return conn; },
    resync: async () => { order.push('resync'); },
    planOf: async () => { order.push(`plan:${plan}`); const p = plan; plan = 'cloud'; return p; },
    setForeground: (id) => { order.push(`fg:${id}`); },
    cloudSpec: SPEC, sleep: c.sleep, now: c.now,
  });
  assert.deepEqual(order, ['save:u1', 'add:cloud:cloud:clerk', 'plan:free', 'plan:cloud', 'fg:cloud']);
  assert.deepEqual(out, { connection: conn, planReady: true, added: true });
});

test('completion on an existing cloud connection re-resolves it instead of adding a second', async () => {
  const c = clock();
  const order: string[] = [];
  const had = { id: 'cloud' };
  const out = await finishUpgrade(SESSION, {
    saveSession: () => { order.push('save'); },
    existing: () => had,
    addConnection: async () => { throw new Error('must not add a second cloud connection'); },
    resync: async (x) => { order.push(`resync:${x.id}`); },
    planOf: async () => 'cloud',
    setForeground: (id) => { order.push(`fg:${id}`); },
    cloudSpec: SPEC, sleep: c.sleep, now: c.now,
  });
  assert.deepEqual(order, ['save', 'resync:cloud', 'fg:cloud']);
  assert.equal(out.added, false);
});

test('completion lands even when the webhook is slow — the swap happens, planReady says so', async () => {
  const c = clock();
  let fg = '';
  const out = await finishUpgrade(SESSION, {
    saveSession: () => {}, existing: () => undefined,
    addConnection: async () => ({ id: 'cloud' }), resync: async () => {},
    planOf: async () => 'free', setForeground: (id) => { fg = id; },
    cloudSpec: SPEC, sleep: c.sleep, now: c.now, planWaitMs: 5000,
  });
  assert.equal(fg, 'cloud');
  assert.equal(out.planReady, false);
});
