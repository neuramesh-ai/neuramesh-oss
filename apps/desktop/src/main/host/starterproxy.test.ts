// THE STREAMED STARTER DOOR, MACHINE SIDE (host/starterproxy.ts + the loop in orchturn.ts).
//
// What must hold: the words reach the bubble in order and as the whole text so far; the answer is
// the SAME body the whole-reply door returns, so the loop's final text is unchanged; a tool round
// survives the stream with its call id and thought signature intact; and a machine newer than its
// API (a 404) answers exactly as before, without a word. The proxy here is a fake that speaks the
// route's NDJSON, cut at odd byte offsets the way a network cuts it.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/starterproxy.test.ts
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { z } from 'zod';
import { STREAM_RECHECK_MS, resetStarterStreamProbe, starterGenerate, starterStream } from './starterproxy';
import { geminiDispatch, geminiOrchestratorTurn } from './orchturn';
import type { OrchTool } from './orchtools';

const CALL = { apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], config: { systemInstruction: 'sys' } };
const BASE = { model: 'gemini-3.5-flash-lite', token: '', systemPrompt: 'you are the orchestrator', transcript: 'hello', tools: [] as OrchTool[] };
const CTX = { apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1' };
const enc = new TextEncoder();

const body = (parts: unknown[]) => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 72, candidatesTokenCount: 9 }, credits: { remaining: 399, spentMicros: 45 } });
const words = (...texts: string[]) => texts.map((text) => ({ t: 'text', text }));

/** an NDJSON body cut every `step` bytes (a network read rarely ends on a line) */
function ndjson(lines: object[], step = 5): ReadableStream<Uint8Array> {
  const bytes = enc.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  let at = 0;
  return new ReadableStream<Uint8Array>({ pull(ctl) { if (at >= bytes.length) { ctl.close(); return; } ctl.enqueue(bytes.subarray(at, at + step)); at += step; } });
}

type Reply = { status?: number; lines?: object[]; json?: unknown; step?: number };
function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = replies.shift() ?? { status: 500, json: {} };
    if (r.lines) return new Response(ndjson(r.lines, r.step), { status: r.status ?? 200, headers: { 'content-type': 'application/x-ndjson' } });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

let undo: (() => void) | null = null;
afterEach(() => { undo?.(); undo = null; resetStarterStreamProbe(); });

describe('the streamed door', () => {
  test('the words reach onText in order, and the answer is the done body', async () => {
    const done = body([{ text: 'Hello, world' }]);
    const f = stubFetch([{ lines: [...words('Hel', 'lo, ', 'world'), { t: 'done', response: done }] }]); undo = f.restore;
    const seen: string[] = [];
    const out = await starterStream({ ...CALL, onText: (d) => seen.push(d) });
    assert.deepEqual(seen, ['Hel', 'lo, ', 'world']);
    assert.deepEqual(out, done);
    assert.equal(f.calls[0]!.url, 'https://api.test/v1/starter/stream');
    assert.equal(f.calls[0]!.headers['accept'], 'application/x-ndjson');
    assert.equal(f.calls[0]!.headers['accept-encoding'], 'identity');
    assert.deepEqual(JSON.parse(f.calls[0]!.headers['x-nm-actor'] ?? '{}'), { kind: 'human', id: 'u-1' });
  });

  test('it sends exactly what the whole-reply door sends', async () => {
    const f = stubFetch([{ lines: [{ t: 'done', response: body([{ text: 'a' }]) }] }, { json: body([{ text: 'a' }]) }]); undo = f.restore;
    await starterStream({ ...CALL, onText: () => {} });
    await starterGenerate(CALL);
    assert.deepEqual(f.calls[0]!.body, f.calls[1]!.body);
    assert.deepEqual(f.calls[0]!.body, { workspace: 'ws-1', contents: CALL.contents, system: 'sys' });
  });

  test('a character cut across two reads arrives whole', async () => {
    const f = stubFetch([{ lines: [...words('naïve ✓ — déjà'), { t: 'done', response: body([{ text: 'naïve ✓ — déjà' }]) }], step: 3 }]); undo = f.restore;
    const seen: string[] = [];
    await starterStream({ ...CALL, onText: (d) => seen.push(d) });
    assert.deepEqual(seen, ['naïve ✓ — déjà']);
  });

  test('an API older than the door answers 404: the whole-reply door serves the turn, and the probe rests', async () => {
    const whole = body([{ text: 'from the old door' }]);
    const f = stubFetch([{ status: 404, json: { error: 'not found' } }, { json: whole }, { json: whole }]); undo = f.restore;
    assert.deepEqual(await starterStream({ ...CALL, onText: () => assert.fail('no words from the old door') }), whole);
    assert.deepEqual(f.calls.map((c) => c.url), ['https://api.test/v1/starter/stream', 'https://api.test/v1/starter/generate']);
    // inside the window: straight to the old door, no second 404
    await starterStream({ ...CALL, onText: () => {} });
    assert.equal(f.calls[2]!.url, 'https://api.test/v1/starter/generate');
  });

  test('after the window the machine asks again, so a deploy is picked up without a restart', async () => {
    const f = stubFetch([{ status: 404 }, { json: body([]) }, { lines: [{ t: 'done', response: body([{ text: 'new' }]) }] }]); undo = f.restore;
    await starterStream({ ...CALL, onText: () => {} });
    const realNow = Date.now;
    Date.now = () => realNow() + STREAM_RECHECK_MS + 1;
    try { await starterStream({ ...CALL, onText: () => {} }); } finally { Date.now = realNow; }
    assert.equal(f.calls[2]!.url, 'https://api.test/v1/starter/stream');
  });

  test('402 is the same readable refusal the whole-reply door gives', async () => {
    const f = stubFetch([{ status: 402, json: { code: 'NO_CREDITS' } }]); undo = f.restore;
    await assert.rejects(starterStream({ ...CALL, onText: () => {} }), /out of credits.*connect your own brain/);
  });

  test('a failure after the reply began fails the turn and names the code', async () => {
    const f = stubFetch([{ lines: [...words('half'), { t: 'error', error: 'starter brain call failed', code: 'UPSTREAM' }] }]); undo = f.restore;
    await assert.rejects(starterStream({ ...CALL, onText: () => {} }), /starter brain unavailable \(stream UPSTREAM\)/);
  });

  test('a stream that ends before the answer fails rather than answering blank', async () => {
    const f = stubFetch([{ lines: words('cut off') }]); undo = f.restore;
    await assert.rejects(starterStream({ ...CALL, onText: () => {} }), /ended before the answer/);
  });

  test('a bubble that throws never costs the turn', async () => {
    const done = body([{ text: 'fine' }]);
    const f = stubFetch([{ lines: [...words('fine'), { t: 'done', response: done }] }]); undo = f.restore;
    assert.deepEqual(await starterStream({ ...CALL, onText: () => { throw new Error('window gone'); } }), done);
  });
});

describe('a watched house turn types as it is written', () => {
  test('the dispatch streams when a bubble watches, and the final text is the non-streamed one', async () => {
    const reply = body([{ text: 'You have no open tasks.' }]);
    const f = stubFetch([{ lines: [...words('You have', ' no open', ' tasks.'), { t: 'done', response: reply }] }, { json: reply }]); undo = f.restore;
    const seen: string[] = [];
    const streamed = await geminiDispatch({ ...BASE, onDelta: (t) => seen.push(t) }, { houseModel: true, ...CTX });
    const whole = await geminiDispatch({ ...BASE }, { houseModel: true, ...CTX });
    assert.deepEqual(seen, ['You have', 'You have no open', 'You have no open tasks.']);
    assert.equal(streamed, whole);
    assert.deepEqual(f.calls.map((c) => c.url), ['https://api.test/v1/starter/stream', 'https://api.test/v1/starter/generate']);
  });

  test('a tool round survives the stream: the call runs, its id and signature go back intact, the next round types afresh', async () => {
    const ran: unknown[] = [];
    const tool: OrchTool = { name: 'list_tasks', description: 'list the board', schema: { state: z.string() }, run: async (i) => { ran.push(i); return 'two tasks'; } };
    const round1 = body([{ text: 'Checking the board.' }, { functionCall: { name: 'list_tasks', args: { state: 'todo' }, id: 'call_1' }, thoughtSignature: 'c2ln' }]);
    const f = stubFetch([
      { lines: [...words('Checking', ' the board.'), { t: 'done', response: round1 }] },
      { lines: [...words('You have', ' two tasks.'), { t: 'done', response: body([{ text: 'You have two tasks.' }]) }] },
    ]);
    undo = f.restore;
    const seen: string[] = [];
    const out = await geminiOrchestratorTurn({ ...BASE, tools: [tool], starter: true, ...CTX, onDelta: (t) => seen.push(t) });
    assert.equal(out, 'You have two tasks.');
    assert.deepEqual(ran, [{ state: 'todo' }]);
    assert.deepEqual(seen, ['Checking', 'Checking the board.', 'You have', 'You have two tasks.']);
    const second = f.calls[1]!.body;
    assert.deepEqual(second.contents[1], round1.candidates[0]!.content, 'the model turn goes back exactly as it came');
    assert.deepEqual(second.contents[2].parts[0].functionResponse, { id: 'call_1', name: 'list_tasks', response: { result: 'two tasks' } });
  });

  test('a narrated call never types itself out in the bubble', async () => {
    const tool: OrchTool = { name: 'set_thread_title', description: 'title the thread', schema: { title: z.string() }, run: async () => 'ok' };
    const f = stubFetch([{ lines: [...words('set_thread_title({"title":"Plans"})\n', 'Here is the plan.'), { t: 'done', response: body([{ text: 'set_thread_title({"title":"Plans"})\nHere is the plan.' }]) }] }]);
    undo = f.restore;
    const seen: string[] = [];
    const out = await geminiOrchestratorTurn({ ...BASE, tools: [tool], starter: true, ...CTX, onDelta: (t) => seen.push(t) });
    assert.equal(out, 'Here is the plan.');
    assert.ok(seen.every((t) => !t.includes('set_thread_title')), `the bubble showed: ${JSON.stringify(seen)}`);
    assert.equal(seen.at(-1), 'Here is the plan.');
  });

  test('against an older API the turn answers as it always did', async () => {
    const f = stubFetch([{ status: 404 }, { json: body([{ text: 'old door, same answer' }]) }]); undo = f.restore;
    const out = await geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX, onDelta: () => {} });
    assert.equal(out, 'old door, same answer');
  });

  test('a turn nobody watches keeps the whole-reply door (workers, sweeps)', async () => {
    const f = stubFetch([{ json: body([{ text: 'quiet' }]) }]); undo = f.restore;
    await geminiOrchestratorTurn({ ...BASE, starter: true, ...CTX });
    assert.equal(f.calls[0]!.url, 'https://api.test/v1/starter/generate');
  });
});
