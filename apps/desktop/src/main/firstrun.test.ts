// The first-run doors (docs/design/first-run-doors-2026-09): which profile sees the door, and the
// door's machine over a scripted hand-off. This Mac starts the stack and never opens a browser; the
// cloud doors open the right face and never start the stack; the wait can be re-opened, cancelled,
// and it expires into a fresh start.
//   pnpm exec tsx --test src/main/firstrun.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstRun, handoffPageUrl, isFreshProfile, type FirstRunState } from './firstrun';

test('a fresh profile has no session, no chosen connection, no stack run and no added server', () => {
  assert.equal(isFreshProfile({ clerkSignedIn: false, storedForeground: null, localUsedBefore: false, custom: 0 }), true);
  assert.equal(isFreshProfile({ clerkSignedIn: true, storedForeground: null, localUsedBefore: false, custom: 0 }), false, 'a stored session: the cloud is in front, no door');
  assert.equal(isFreshProfile({ clerkSignedIn: false, storedForeground: 'local', localUsedBefore: false, custom: 0 }), false, 'a chosen connection');
  assert.equal(isFreshProfile({ clerkSignedIn: false, storedForeground: null, localUsedBefore: true, custom: 0 }), false, 'this Mac ran the stack before');
  assert.equal(isFreshProfile({ clerkSignedIn: false, storedForeground: null, localUsedBefore: false, custom: 1 }), false, 'a server added by hand');
});

test('the two cloud doors open the two faces of one page, the nonce on both', () => {
  assert.equal(handoffPageUrl('https://neuramesh.app', 'n-1', 'signin'), 'https://neuramesh.app/desktop-signin?nonce=n-1');
  assert.equal(handoffPageUrl('https://neuramesh.app', 'n-1', 'cloud'), 'https://neuramesh.app/desktop-signin?nonce=n-1&mode=signup');
});

/** a door over a scripted server: /auth/desktop/start answers once, /auth/desktop/poll answers in order
 *  (the last repeats); a 'hang' entry holds the poll until `release()` is called, so the test can act
 *  while the browser is "open" */
function door(polls: Array<Record<string, unknown> | 'hang'>, o: { fresh?: boolean } = {}) {
  const states: FirstRunState[] = [];
  const opened: string[] = [];
  const landed: string[] = [];
  let started = 0;
  let stackStarted = 0;
  let clock = 0;
  let n = 0;
  let release: (() => void) | null = null;
  const fetchImpl: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/auth/desktop/start')) { started++; return new Response(JSON.stringify({ nonce: `n-${started}`, pollSecret: 's' })); }
    if (u.endsWith('/auth/desktop/poll')) {
      const body = JSON.parse(String(init?.body)) as { nonce: string };
      assert.equal(body.nonce, `n-${started}`, 'the poll carries the nonce of the latest start');
      const answer = polls[Math.min(n++, polls.length - 1)] ?? {};
      if (answer === 'hang') { await new Promise<void>((r) => { release = r; }); return new Response(JSON.stringify({ status: 'pending' })); }
      return new Response(JSON.stringify(answer));
    }
    throw new Error(`unscripted ${u}`);
  }) as typeof fetch;
  const fr = new FirstRun({
    fetchImpl, apiUrl: 'https://api.example', webUrl: 'https://neuramesh.app',
    openExternal: async (url) => { opened.push(url); },
    startLocal: async () => { stackStarted++; },
    land: async (s) => { landed.push(s.userId); },
    onState: (s) => states.push(s), log: () => {},
    sleep: async (ms) => { clock += ms; }, now: () => clock, timeoutMs: 10_000, everyMs: 1000,
  }, o.fresh ?? true);
  return { fr, states, opened, landed, count: () => ({ started, stackStarted }), release: () => { release?.(); release = null; } };
}

test('a profile that is not fresh starts done: no door', () => {
  const { fr } = door([], { fresh: false });
  assert.deepEqual(fr.state, { phase: 'done', door: null });
});

test('This Mac starts the stack and opens no browser', async () => {
  const { fr, states, opened, count } = door([]);
  assert.deepEqual(fr.state, { phase: 'choose' });
  await fr.choose('local');
  assert.deepEqual(states.at(-1), { phase: 'done', door: 'local' });
  assert.deepEqual(opened, []);
  assert.deepEqual(count(), { started: 0, stackStarted: 1 });
});

test('Sign in opens the sign-in face, waits, lands the session, and never starts the stack', async () => {
  const { fr, states, opened, landed, count } = door([{ status: 'pending' }, { status: 'done', userId: 'u-george', email: 'g@x.dev', sessionId: 'sess' }]);
  await fr.choose('signin');
  assert.deepEqual(opened, ['https://neuramesh.app/desktop-signin?nonce=n-1']);
  assert.deepEqual(states.map((s) => s.phase), ['waiting', 'landing', 'done']);
  assert.deepEqual(states[0], { phase: 'waiting', door: 'signin', url: 'https://neuramesh.app/desktop-signin?nonce=n-1' });
  assert.deepEqual(landed, ['u-george']);
  assert.equal(count().stackStarted, 0);
});

test('The cloud opens the sign-up face', async () => {
  const { fr, opened, states } = door([{ status: 'done', userId: 'u-new', email: '', sessionId: '' }]);
  await fr.choose('cloud');
  assert.deepEqual(opened, ['https://neuramesh.app/desktop-signin?nonce=n-1&mode=signup']);
  assert.deepEqual(states.at(-1), { phase: 'done', door: 'cloud' });
});

test('Open the page again re-opens the same page, a second Continue too, and Cancel forgets the nonce', async () => {
  const { fr, opened, states, release } = door(['hang']);
  const run = fr.choose('signin');
  await new Promise((r) => setImmediate(r));
  assert.equal(fr.state.phase, 'waiting');
  await fr.reopen();
  await fr.choose('signin');
  assert.deepEqual(opened, ['https://neuramesh.app/desktop-signin?nonce=n-1', 'https://neuramesh.app/desktop-signin?nonce=n-1', 'https://neuramesh.app/desktop-signin?nonce=n-1']);
  fr.cancel();
  release();
  await run;
  assert.deepEqual(states.at(-1), { phase: 'choose' });
  await fr.reopen();
  assert.equal(opened.length, 3, 'nothing to re-open after Cancel');
});

test('the server letting the nonce go, or the budget running out, is the expired card; Try again starts fresh', async () => {
  const gone = door([{ status: 'gone' }]);
  await gone.fr.choose('cloud');
  assert.deepEqual(gone.states.at(-1), { phase: 'expired', door: 'cloud' });
  const slow = door([{ status: 'pending' }]);
  await slow.fr.choose('signin');
  assert.deepEqual(slow.states.at(-1), { phase: 'expired', door: 'signin' });
  // Try again = a new start with a fresh nonce
  slow.fr.cancel();
  await slow.fr.choose('signin');
  assert.equal(slow.count().started, 2);
  assert.equal(slow.opened.at(-1), 'https://neuramesh.app/desktop-signin?nonce=n-2');
});

test('a landing that fails says so, and the door can be tried again', async () => {
  const states: FirstRunState[] = [];
  const fr = new FirstRun({
    fetchImpl: (async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/start') ? { nonce: 'n', pollSecret: 's' } : { status: 'done', userId: 'u', email: '', sessionId: '' }))) as typeof fetch,
    apiUrl: 'https://api.example', webUrl: 'https://neuramesh.app', openExternal: async () => {}, startLocal: async () => {},
    land: async () => { throw new Error('the cloud did not answer'); },
    onState: (s) => states.push(s), log: () => {}, sleep: async () => {}, now: () => 0, timeoutMs: 10_000, everyMs: 1,
  }, true);
  await fr.choose('signin');
  assert.deepEqual(states.at(-1), { phase: 'error', door: 'signin', message: 'the cloud did not answer' });
  fr.cancel();
  assert.deepEqual(fr.state, { phase: 'choose' });
});
