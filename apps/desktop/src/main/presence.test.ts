// Presence pump + reply retry: a status write survives server blips (retried
// until acked or superseded), and a generated reply is never discarded on one
// transient 5xx. Run from apps/desktop:
//   pnpm exec tsx --test src/main/presence.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelayMs, isRetryable, createStatusPump, postWithRetry, type AgentStatus } from './presence';

// a manual timer: schedule() collects callbacks; fire() runs them in order
function manualClock() {
  const q: Array<{ fn: () => void; ms: number }> = [];
  return {
    schedule: (fn: () => void, ms: number) => q.push({ fn, ms }),
    fire: () => { const j = q.shift(); j?.fn(); return j?.ms; },
    pending: () => q.length,
  };
}

// microtask drain — pump settls promises before timers matter
const tick = () => new Promise<void>((r) => setImmediate(r));

test('backoff doubles from base and caps', () => {
  assert.equal(backoffDelayMs(0), 1_000);
  assert.equal(backoffDelayMs(1), 2_000);
  assert.equal(backoffDelayMs(2), 4_000);
  assert.equal(backoffDelayMs(10), 60_000); // capped
  assert.equal(backoffDelayMs(1000), 60_000); // exponent clamped — no overflow to Infinity/0
});

test('retryable: 5xx, 429, network — not other 4xx or 2xx', () => {
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(null), true);
  assert.equal(isRetryable(200), false);
  assert.equal(isRetryable(403), false);
  assert.equal(isRetryable(409), false);
});

test('pump: acked write clears pending', async () => {
  const posts: Array<{ id: string; status: AgentStatus }> = [];
  const pump = createStatusPump({ post: async (id, status) => { posts.push({ id, status }); return 200; } });
  pump.set('a1', 'thinking');
  await tick();
  assert.deepEqual(posts, [{ id: 'a1', status: 'thinking' }]);
  assert.equal(pump.pending('a1'), undefined);
});

test('pump: a dropped clear retries until the server recovers — the stuck-typing class', async () => {
  const clock = manualClock();
  const posts: number[] = [];
  let failures = 3;
  const pump = createStatusPump({
    post: async () => { posts.push(1); return failures-- > 0 ? 500 : 200; },
    schedule: clock.schedule,
  });
  pump.set('a1', 'online');
  await tick();
  assert.equal(pump.pending('a1'), 'online'); // 500 → still owed
  clock.fire(); await tick(); // retry 1 → 500
  clock.fire(); await tick(); // retry 2 → 500
  assert.equal(pump.pending('a1'), 'online');
  clock.fire(); await tick(); // retry 3 → 200
  assert.equal(pump.pending('a1'), undefined);
  assert.equal(posts.length, 4);
  assert.equal(clock.pending(), 0);
});

test('pump: last write wins — a newer status supersedes one stuck in backoff', async () => {
  const clock = manualClock();
  const posts: AgentStatus[] = [];
  let responses = [500, 200, 200][Symbol.iterator]();
  const pump = createStatusPump({
    post: async (_id, status) => { posts.push(status); return responses.next().value ?? 200; },
    schedule: clock.schedule,
  });
  pump.set('a1', 'thinking');
  await tick(); // thinking → 500, backoff scheduled
  pump.set('a1', 'online'); // the finally-clear lands while thinking is in backoff
  await tick();
  clock.fire(); await tick(); // backoff fires → posts the NEWER desired (online), acked
  assert.deepEqual(posts, ['thinking', 'online']);
  assert.equal(pump.pending('a1'), undefined);
});

test('pump: supersede while a post is in flight — the stale ack cannot clear the newer desire', async () => {
  const clock = manualClock();
  const posts: AgentStatus[] = [];
  let release: (n: number) => void = () => {};
  const gate = new Promise<number>((r) => { release = r; });
  let first = true;
  const pump = createStatusPump({
    post: async (_id, status) => {
      posts.push(status);
      if (first) { first = false; return gate; } // hold the first post in flight
      return 200;
    },
    schedule: clock.schedule,
  });
  pump.set('a1', 'thinking'); // in flight, held
  pump.set('a1', 'online');   // supersedes while in flight
  release(200);               // the stale thinking-post acks late
  await tick();
  await tick();
  assert.deepEqual(posts, ['thinking', 'online']); // pump re-posted the newer status
  assert.equal(pump.pending('a1'), undefined);
});

test('pump: a real rejection (4xx) drops the write instead of retrying forever', async () => {
  const clock = manualClock();
  let calls = 0;
  const pump = createStatusPump({ post: async () => { calls++; return 403; }, schedule: clock.schedule });
  pump.set('a1', 'online');
  await tick();
  assert.equal(calls, 1);
  assert.equal(pump.pending('a1'), undefined);
  assert.equal(clock.pending(), 0);
});

test('pump: network errors retry like 5xx', async () => {
  const clock = manualClock();
  let calls = 0;
  const pump = createStatusPump({
    post: async () => { calls++; if (calls === 1) throw new Error('fetch failed'); return 200; },
    schedule: clock.schedule,
  });
  pump.set('a1', 'online');
  await tick();
  assert.equal(pump.pending('a1'), 'online');
  clock.fire(); await tick();
  assert.equal(pump.pending('a1'), undefined);
  assert.equal(calls, 2);
});

test('pump: agents retry independently', async () => {
  const clock = manualClock();
  const byAgent = new Map<string, number>();
  const pump = createStatusPump({
    post: async (id) => { byAgent.set(id, (byAgent.get(id) ?? 0) + 1); return id === 'sick' ? 500 : 200; },
    schedule: clock.schedule,
  });
  pump.set('sick', 'online');
  pump.set('fine', 'online');
  await tick();
  assert.equal(pump.pending('fine'), undefined);
  assert.equal(pump.pending('sick'), 'online');
});

test('postWithRetry: ok first try', async () => {
  const r = await postWithRetry(async () => 200, { sleep: async () => {} });
  assert.deepEqual(r, { outcome: 'ok', httpStatus: 200, tries: 1 });
});

test('postWithRetry: transient 500s then success — the reply is not discarded', async () => {
  const seq = [500, 502, 201][Symbol.iterator]();
  const retries: string[] = [];
  const r = await postWithRetry(async () => seq.next().value ?? 201, {
    sleep: async () => {},
    onRetry: (attempt, _delay, why) => retries.push(`${attempt}:${why}`),
  });
  assert.deepEqual(r, { outcome: 'ok', httpStatus: 201, tries: 3 });
  assert.deepEqual(retries, ['1:http 500', '2:http 502']);
});

test('postWithRetry: 409 stands down immediately — the exactly-once index already has a reply', async () => {
  let calls = 0;
  const r = await postWithRetry(async () => { calls++; return 409; }, { sleep: async () => {} });
  assert.deepEqual(r, { outcome: 'conflict', httpStatus: 409, tries: 1 });
  assert.equal(calls, 1);
});

test('postWithRetry: a real rejection (422) never retries', async () => {
  let calls = 0;
  const r = await postWithRetry(async () => { calls++; return 422; }, { sleep: async () => {} });
  assert.deepEqual(r, { outcome: 'rejected', httpStatus: 422, tries: 1 });
  assert.equal(calls, 1);
});

test('postWithRetry: exhausts bounded attempts on a dead server', async () => {
  let calls = 0;
  const r = await postWithRetry(async () => { calls++; throw new Error('down'); }, { attempts: 4, sleep: async () => {} });
  assert.deepEqual(r, { outcome: 'gave_up', httpStatus: null, tries: 4 });
  assert.equal(calls, 4);
});
