// REX'S FIRST REPLY, END TO END (2026-10-27, the sandbox browser run): the starter brain on the
// NeuraMesh brain pack narrated its set_thread_title call as text, a ```json fence of arguments and a
// markdown link glued to the fence's closing backticks. The room read both, and the thread kept its
// provisional title. This drives the house turn with that exact body: the posted reply is the answer
// alone, the bubble never types any piece of the call, and the title lands once, with its arguments.
// Run from apps/desktop: pnpm exec tsx --test src/main/host/narrated-title.test.ts
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import { geminiOrchestratorTurn } from './orchturn';
import { resetStarterStreamProbe } from './starterproxy';
import type { OrchTool } from './orchtools';

const ANSWER = 'I am Rex, the orchestrator for this build room, coordinating the team and turning requests into shippable work.';
const REX = '```json\n{\n  "title": "Agent Introduction",\n  "description": "Introduce the agent role in the build channel"\n}\n```[set_thread_title](title="Agent Introduction", description="Introduce the agent role in the build channel")\n\n' + ANSWER;
const REX_ARGS = { title: 'Agent Introduction', description: 'Introduce the agent role in the build channel' };

const BASE = { model: 'gemini-3.5-flash-lite', token: '', systemPrompt: 'you are the orchestrator', transcript: '@rex introduce yourself in one sentence.', starter: true, apiUrl: 'https://api.test', workspace: 'ws-1', actorId: 'u-1' };
const body = (parts: unknown[]) => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 72, candidatesTokenCount: 9 }, credits: { remaining: 399, spentMicros: 45 } });
const enc = new TextEncoder();

/** the proxy's NDJSON, cut every `step` bytes the way a network read cuts it */
function ndjson(lines: object[], step = 5): ReadableStream<Uint8Array> {
  const bytes = enc.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  let at = 0;
  return new ReadableStream<Uint8Array>({ pull(ctl) { if (at >= bytes.length) { ctl.close(); return; } ctl.enqueue(bytes.subarray(at, at + step)); at += step; } });
}

type Reply = { lines?: object[]; json?: unknown };
function stubFetch(replies: Reply[]) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const r = replies.shift() ?? { json: {} };
    if (r.lines) return new Response(ndjson(r.lines), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    return new Response(JSON.stringify(r.json ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** the triage registry's title tool, as host/tools-room.ts declares it, recording each run */
function titleTool(ran: unknown[]): OrchTool {
  return {
    name: 'set_thread_title',
    description: 'Rename THIS conversation thread.',
    schema: { title: z.string().min(1).max(60), description: z.string().max(200).optional() },
    run: async (input) => { ran.push(input); return `thread titled “${(input as { title: string }).title}”`; },
  };
}

let undo: (() => void) | null = null;
afterEach(() => { undo?.(); undo = null; resetStarterStreamProbe(); });

test('the whole-reply door: the narrated title runs once with its arguments, and the reply is the answer alone', async () => {
  const ran: unknown[] = [];
  const f = stubFetch([{ json: body([{ text: REX }]) }]); undo = f.restore;
  const out = await geminiOrchestratorTurn({ ...BASE, tools: [titleTool(ran)] });
  assert.equal(out, ANSWER);
  assert.deepEqual(ran, [REX_ARGS]);
  assert.deepEqual(f.calls, ['https://api.test/v1/starter/generate'], 'one round: a narrated call costs no second model call');
});

test('the streamed door: no update of the bubble types any piece of the call, and the title still lands', async () => {
  const ran: unknown[] = [];
  const words = Array.from({ length: Math.ceil(REX.length / 7) }, (_, i) => ({ t: 'text', text: REX.slice(i * 7, i * 7 + 7) }));
  const f = stubFetch([{ lines: [...words, { t: 'done', response: body([{ text: REX }]) }] }]); undo = f.restore;
  const fed: string[] = [];
  const out = await geminiOrchestratorTurn({ ...BASE, tools: [titleTool(ran)], onDelta: (t) => { fed.push(t); } });
  assert.equal(out, ANSWER);
  assert.deepEqual(ran, [REX_ARGS]);
  for (const t of fed) {
    for (const piece of ['set_thread_title', '```', '"title"', 'description=']) assert.ok(!t.includes(piece), `the bubble showed ${JSON.stringify(t)}`);
  }
  assert.equal(fed.at(-1), ANSWER);
});

test('a title the tool would refuse is not run from narration, and the reply still leaves clean', async () => {
  const ran: unknown[] = [];
  const long = REX.replaceAll('Agent Introduction', 'A'.repeat(61));
  const f = stubFetch([{ json: body([{ text: long }]) }]); undo = f.restore;
  assert.equal(await geminiOrchestratorTurn({ ...BASE, tools: [titleTool(ran)] }), ANSWER);
  assert.deepEqual(ran, []);
});

test('a title the turn already set for real is not set again from the narration', async () => {
  const ran: unknown[] = [];
  const f = stubFetch([
    { json: body([{ functionCall: { name: 'set_thread_title', args: { title: 'Rex introduction' } } }]) },
    { json: body([{ text: REX }]) },
  ]); undo = f.restore;
  assert.equal(await geminiOrchestratorTurn({ ...BASE, tools: [titleTool(ran)] }), ANSWER);
  assert.deepEqual(ran, [{ title: 'Rex introduction' }]);
});

test('a narrated call to any other tool is dropped from the reply and never run', async () => {
  const ran: unknown[] = [];
  const createTask: OrchTool = { name: 'create_task', description: 'create a unit', schema: { title: z.string() }, run: async (input) => { ran.push(input); return 'created'; } };
  const f = stubFetch([{ json: body([{ text: `[create_task](title="Ship the intro")\n\n${ANSWER}` }]) }]); undo = f.restore;
  assert.equal(await geminiOrchestratorTurn({ ...BASE, tools: [titleTool([]), createTask] }), ANSWER);
  assert.deepEqual(ran, []);
});
