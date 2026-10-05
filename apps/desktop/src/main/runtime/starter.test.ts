// The Starter worker lane's pure parts (runtime/starter.ts): the seat rule, the workspace jail the
// file tools stand behind, the toolset a turn gets, and the loud failure when no lane was set.
// Run from apps/desktop: pnpm exec tsx --test src/main/runtime/starter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_MODEL } from '@neuramesh/shared';
import { busToolsForStarter, insideDir, isStarterSeat, setStarterLane, starterComplete } from './starter';
import { geminiAdapter } from './gemini';
import { resetStarterStreamProbe } from '../host/starterproxy';
import type { HostedAgent } from '../agents';

test('the seat rule: the house model with no token of the user\'s own is the Starter lane', () => {
  assert.equal(isStarterSeat(STARTER_MODEL, ''), true);
  assert.equal(isStarterSeat(STARTER_MODEL, null), true);
  assert.equal(isStarterSeat(STARTER_MODEL, 'AIza-user-key'), false); // their key, their bill
  assert.equal(isStarterSeat('gemini-3.5-flash', ''), false);
  assert.equal(isStarterSeat('claude-sonnet-5', ''), false);
});

test('the file tools never leave the workspace', () => {
  const dir = '/tmp/nm-ws/nm-1094';
  assert.equal(insideDir(dir, 'posts.json'), '/tmp/nm-ws/nm-1094/posts.json');
  assert.equal(insideDir(dir, '.nm-evidence/design/a.html'), '/tmp/nm-ws/nm-1094/.nm-evidence/design/a.html');
  assert.equal(insideDir(dir, '../secrets.txt'), null);
  assert.equal(insideDir(dir, '/etc/passwd'), null);
  assert.equal(insideDir(dir, 'a/../../b'), null);
  assert.equal(insideDir(dir, ''), null);
});

test('a work turn gets the bus tools the host can service, in the loop\'s shape', () => {
  const tools = busToolsForStarter('work', {
    dir: '/tmp/x',
    recordLesson: async () => ({ ok: true }),
    addBacklogItem: async () => ({ ok: true, number: 1 }),
    beats: { declare: () => 'ok', complete: () => 'ok' },
  });
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_backlog_item', 'add_subtask', 'advance_beat', 'declare_beats', 'record_lesson']);
  for (const t of tools) { assert.equal(typeof t.run, 'function'); assert.equal(typeof t.description, 'string'); assert.equal(typeof t.schema, 'object'); }
});

test('a leg turn never sees add_subtask, and no closure means no tool (the bus rules, unchanged)', () => {
  const names = busToolsForStarter('leg', { dir: '/tmp/x', addBacklogItem: async () => ({ ok: true }), recordLesson: async () => ({ ok: true }) }).map((t) => t.name).sort();
  assert.deepEqual(names, ['record_lesson']);
  assert.deepEqual(busToolsForStarter('work', { dir: '/tmp/x' }), []);
});

test('with no lane set, the proxy is never reached — it fails loudly', async () => {
  setStarterLane(null);
  await assert.rejects(() => starterComplete('sys', 'hi'), /Starter lane is not configured/);
});

test('a watched chat reply streams: the bubble gets the words so far, the answer is the same whole text', async () => {
  const done = { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello there.' }] } }], credits: { remaining: 1, spentMicros: 1 } };
  const lines = [{ t: 'text', text: 'Hel' }, { t: 'text', text: 'lo' }, { t: 'text', text: ' there.' }, { t: 'done', response: done }];
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return String(url).endsWith('/stream')
      ? new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(''), { headers: { 'content-type': 'application/x-ndjson' } })
      : new Response(JSON.stringify(done), { headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  setStarterLane({ apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1' });
  try {
    const seen: string[] = [];
    assert.equal(await starterComplete('sys', 'hi', (t) => seen.push(t)), 'Hello there.');
    assert.deepEqual(seen, ['Hel', 'Hello', 'Hello there.']);
    // unwatched (complete(), the architect's drafts): the whole-reply door, as before
    assert.equal(await starterComplete('sys', 'hi'), 'Hello there.');
    assert.deepEqual(urls, ['https://api.test/v1/starter/stream', 'https://api.test/v1/starter/generate']);
  } finally {
    globalThis.fetch = real;
    setStarterLane(null);
  }
});

/** one test on a faked lane: the streamed door answers `lines` (or `streamStatus`), the whole-reply door `whole` */
async function onFakeLane(reply: { lines?: object[]; whole: unknown; streamStatus?: number }, run: (seen: Array<{ url: string; body: any }>) => Promise<void>): Promise<void> {
  const seen: Array<{ url: string; body: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
    if (!String(url).endsWith('/stream')) return new Response(JSON.stringify(reply.whole), { headers: { 'content-type': 'application/json' } });
    if (reply.streamStatus) return new Response('{}', { status: reply.streamStatus });
    return new Response((reply.lines ?? []).map((l) => `${JSON.stringify(l)}\n`).join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  }) as typeof globalThis.fetch;
  setStarterLane({ apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1' });
  try { await run(seen); } finally { globalThis.fetch = real; setStarterLane(null); resetStarterStreamProbe(); }
}

const reply = (...parts: object[]) => ({ candidates: [{ content: { role: 'model', parts } }], credits: { remaining: 1, spentMicros: 1 } });

test('a watched chat reply shows its thoughts beside the words, ends on the answer, and the answer carries none', async () => {
  const done = reply({ text: 'Weighing the ask.', thought: true }, { text: 'Hello there.' });
  const lines = [{ t: 'thought', text: 'Weighing' }, { t: 'thought', text: ' the ask.' }, { t: 'text', text: 'Hello' }, { t: 'text', text: ' there. ' }, { t: 'done', response: done }];
  await onFakeLane({ lines, whole: done }, async (seen) => {
    const fed: Array<[string, string | undefined]> = [];
    assert.equal(await starterComplete('sys', 'hi', (t, th) => { fed.push([t, th]); }), 'Hello there.');
    assert.deepEqual(fed, [
      ['', 'Weighing'],
      ['', 'Weighing the ask.'],
      ['Hello', 'Weighing the ask.'],
      ['Hello there. ', 'Weighing the ask.'],
      ['Hello there.', 'Weighing the ask.'], // the answer differs from the words by a trim: one last update
    ]);
    assert.equal(seen[0]!.body.thoughts, true);
    // unwatched (complete(), the architect's drafts): no flag, and still no thought text in the answer
    assert.equal(await starterComplete('sys', 'hi'), 'Hello there.');
    assert.equal('thoughts' in seen[1]!.body, false);
  });
});

test('against an older API (404) the bubble still ends on the whole answer', async () => {
  const whole = reply({ text: 'From the old door.' });
  await onFakeLane({ whole, streamStatus: 404 }, async (seen) => {
    const fed: Array<[string, string | undefined]> = [];
    assert.equal(await starterComplete('sys', 'hi', (t, th) => { fed.push([t, th]); }), 'From the old door.');
    assert.deepEqual(fed, [['From the old door.', undefined]]);
    assert.deepEqual(seen.map((s) => s.url), ['https://api.test/v1/starter/stream', 'https://api.test/v1/starter/generate']);
    assert.deepEqual(seen[1]!.body, seen[0]!.body, 'the fallback sends the same body, the flag included');
  });
});

test('a chat bubble that throws never costs the reply, its last update included', async () => {
  // the streamed words differ from the answer by a trim, so the reply makes one last update
  const done = reply({ text: 'Weighing.', thought: true }, { text: 'Hello there. ' });
  const lines = [{ t: 'thought', text: 'Weighing.' }, { t: 'text', text: 'Hello there. ' }, { t: 'done', response: done }];
  await onFakeLane({ lines, whole: done }, async () => {
    const agent = { name: 'iris', role: 'marketer', model: STARTER_MODEL, brief: null } as unknown as HostedAgent;
    assert.equal(await geminiAdapter.streamTurn(agent, 'general', 'hi', '', undefined, () => { throw new Error('window gone'); }), 'Hello there.');
  });
});

test('the gemini adapter\'s starter seat ends on the answer with its thoughts: no last update erases them', async () => {
  const done = reply({ text: 'Weighing.', thought: true }, { text: 'Hello there.' });
  const lines = [{ t: 'thought', text: 'Weighing.' }, { t: 'text', text: 'Hello there.' }, { t: 'done', response: done }];
  await onFakeLane({ lines, whole: done }, async () => {
    const fed: Array<[string, string | undefined]> = [];
    const agent = { name: 'iris', role: 'marketer', model: STARTER_MODEL, brief: null } as unknown as HostedAgent;
    assert.equal(await geminiAdapter.streamTurn(agent, 'general', 'hi', '', undefined, (t, th) => { fed.push([t, th]); }), 'Hello there.');
    assert.deepEqual(fed, [['', 'Weighing.'], ['Hello there.', 'Weighing.']]);
  });
});
