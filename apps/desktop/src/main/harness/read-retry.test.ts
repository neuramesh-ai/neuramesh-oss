// A READ THE FIRST TURN DEPENDS ON (2026-11-17): a slow, dropped or 5xx read is tried again, a refusal
// is not, and a read that stays slow fails in the caller's sentence instead of Node's.
// Run from apps/desktop: pnpm exec tsx --test src/main/harness/read-retry.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWithRetry } from './read-retry';

const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const opts = (waits: number[]) => ({ timeoutMs: 1_000, slowText: 'It did not load in time.', sleep: async (ms: number) => { waits.push(ms); } });

test('a timeout is tried again with a pause, and the next answer is used', async () => {
  const waits: number[] = [];
  let n = 0;
  const res = await readWithRetry(async () => { if (n++ === 0) throw timeout(); return new Response('ok'); }, opts(waits));
  assert.equal(await res.text(), 'ok');
  assert.deepEqual(waits, [1_000]);
});

test('every attempt gets its own limit', async () => {
  const signals: AbortSignal[] = [];
  let n = 0;
  await readWithRetry(async (signal) => { signals.push(signal); if (n++ < 2) throw new TypeError('fetch failed'); return new Response('ok'); }, opts([]));
  assert.equal(new Set(signals).size, 3);
});

test('three slow attempts fail in the sentence a person reads', async () => {
  const waits: number[] = [];
  await assert.rejects(readWithRetry(async () => { throw timeout(); }, opts(waits)), (e: Error) => e.message === 'It did not load in time.' && (e.cause as Error).name === 'TimeoutError');
  assert.deepEqual(waits, [1_000, 3_000]);
});

test('the last 5xx goes back to the caller, and a 4xx is never retried', async () => {
  let n = 0;
  assert.equal((await readWithRetry(async () => { n++; return new Response('', { status: 503 }); }, opts([]))).status, 503);
  assert.equal(n, 3);
  n = 0;
  assert.equal((await readWithRetry(async () => { n++; return new Response('', { status: 404 }); }, opts([]))).status, 404);
  assert.equal(n, 1);
});

test('an error of the caller\'s own is not a slow read: it throws at once', async () => {
  let n = 0;
  await assert.rejects(readWithRetry(async () => { n++; throw new Error('bad header'); }, opts([])), /bad header/);
  assert.equal(n, 1);
});
