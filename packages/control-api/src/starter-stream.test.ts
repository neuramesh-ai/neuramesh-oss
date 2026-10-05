// THE STREAMED STARTER DOOR (starter-stream.ts). What must not be wrong: the price (the same as the
// whole-reply door for the same usage), the count (one charge per model call, whatever happened),
// the guards (all of them before any model call), and the answer (the SAME body the whole-reply
// door returns, function calls and thought signatures intact). The upstream is a scripted SSE body
// in Google's own shape, CRLF included, as recorded from gemini-3.5-flash-lite on 2026-09-25.
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STARTER_MODEL, STARTER_THINKING_LEVEL, priceModelCall } from '@neuramesh/shared';
import { creditRoutes, type Ledger } from './credits.js';
import { sseChunks, starterAssembly, starterReplyStream, type StarterChunk } from './starter-stream.js';
import type { Store } from './store';

const WS = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
const enc = new TextEncoder();
const usage = (inTok: number, outTok: number) => ({ promptTokenCount: inTok, candidatesTokenCount: outTok, totalTokenCount: inTok + outTok });
const textChunk = (text: string, out: number, extra: Record<string, unknown> = {}): StarterChunk =>
  ({ candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0, ...extra }], usageMetadata: usage(72, out), modelVersion: STARTER_MODEL, responseId: 'r-1' });
/** the recorded function-call round: words, the call (id + signature), then an empty closing part */
const CALL_ROUND: StarterChunk[] = [
  textChunk('I will', 2),
  textChunk(' check the time now.', 7),
  { candidates: [{ content: { parts: [{ functionCall: { name: 'get_time', args: { zone: 'UTC' }, id: 'call_1' }, thoughtSignature: 'c2lnbmVk' }], role: 'model' }, index: 0 }], usageMetadata: usage(72, 23), modelVersion: STARTER_MODEL, responseId: 'r-1' },
  textChunk('', 23, { finishReason: 'STOP' }),
];
const REPLY: StarterChunk[] = [textChunk('Hel', 1), textChunk('lo, ', 3), textChunk('world', 4), textChunk('', 4, { finishReason: 'STOP' })];
const partsChunk = (parts: Array<{ text?: string; thought?: boolean; thoughtSignature?: string }>, out: number): StarterChunk =>
  ({ candidates: [{ content: { parts, role: 'model' }, index: 0 }], usageMetadata: usage(72, out), modelVersion: STARTER_MODEL, responseId: 'r-2' });
/** a round with thought summaries on, in the shape Google's thinking docs give (not a recording: at
 *  the starter's level the model seldom thinks). A chunk with only a thought, then one chunk with a
 *  thought and words, and the signature on the last thought */
const THINK_ROUND: StarterChunk[] = [
  partsChunk([{ text: '**Reading the ask**', thought: true }], 0),
  partsChunk([{ text: ' The user wants the time.', thought: true, thoughtSignature: 'dGhvdWdodA==' }, { text: 'It is' }], 3),
  textChunk(' noon.', 5),
  textChunk('', 5, { finishReason: 'STOP' }),
];

const sseBytes = (chunks: StarterChunk[]): Uint8Array => enc.encode(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(''));

/** an SSE body, delivered one piece per read (a pull source, so an error lands AFTER the bytes
 *  before it were read, as on a socket). `pieces` cuts the bytes at odd offsets; `then` decides
 *  how it ends; an aborted signal errors it the way undici's fetch does. */
function sseBody(chunks: StarterChunk[], o: { pieces?: number; then?: 'close' | 'error' | 'hang'; signal?: AbortSignal; delayMs?: number } = {}): ReadableStream<Uint8Array> {
  const bytes = sseBytes(chunks);
  const step = o.pieces ?? bytes.length;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    async start(ctl) {
      o.signal?.addEventListener('abort', () => { try { ctl.error(new DOMException('This operation was aborted', 'AbortError')); } catch { /* closed */ } });
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
    },
    async pull(ctl) {
      if (o.signal?.aborted) return;
      if (at < bytes.length) { ctl.enqueue(bytes.subarray(at, at + step)); at += step; return; }
      if (o.then === 'error') ctl.error(new Error('socket hang up'));
      else if (o.then === 'hang') await new Promise<void>((r) => o.signal?.addEventListener('abort', () => r()));
      else ctl.close();
    },
  });
}

/** the turn a machine posts, as the machines before the thoughts flag post it */
const ASK = { workspace: WS, contents: [{ role: 'user', parts: [{ text: 'hi' }] }], system: 'be brief' };

type Script = { status?: number; json?: unknown; sse?: StarterChunk[]; then?: 'close' | 'error' | 'hang'; delayMs?: number };
function upstream(script: Script) {
  const calls: Array<{ url: string; raw: string; body: unknown; signal?: AbortSignal | null }> = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, raw: String(init.body), body: JSON.parse(String(init.body)), signal: init.signal });
    if (script.sse) return new Response(sseBody(script.sse, { then: script.then, signal: init.signal ?? undefined, delayMs: script.delayMs }), { status: script.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify(script.json ?? {}), { status: script.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchFn };
}

function mk(script: Script, over: { balance?: number; members?: string[] } = {}) {
  const spends: Array<{ workspace: string; micros: number; tokens: { inTokens: number; outTokens: number } }> = [];
  let charged: () => void = () => {};
  const chargedOnce = new Promise<void>((r) => { charged = r; });
  const ledger = {
    balance: async () => ({ grantedMicros: 5_000_000, spentMicros: 0, purchasedMicros: 0, purchasedSpentMicros: 0, remainingMicros: over.balance ?? 4_000_000, grantRemainingMicros: 4_000_000, purchasedRemainingMicros: 0, periodStart: '2026-09-01' }),
    spend: async (workspace: string, micros: number, tokens: { inTokens: number; outTokens: number }) => { spends.push({ workspace, micros, tokens }); charged(); return { remainingMicros: 4_000_000 - micros }; },
  } as unknown as Ledger;
  const store = { humanMemberIds: async () => over.members ?? ['u-me'], agentWorkspace: async () => WS } as unknown as Store;
  const up = upstream(script);
  const app = new Hono();
  app.use('/v1/*', async (c, next) => { c.set('actor' as never, { kind: 'human', id: 'u-me' } as never); await next(); });
  creditRoutes(app as never, store, ledger, up.fetchFn);
  const post = (path: string, body: unknown = ASK) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { post, spends, chargedOnce, calls: up.calls };
}

async function lines(res: Response): Promise<Array<Record<string, any>>> {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

let prevKey: string | undefined;
beforeAll(() => { prevKey = process.env['STARTER_GOOGLE_API_KEY']; process.env['STARTER_GOOGLE_API_KEY'] = 'test-key-never-real'; });
afterAll(() => { if (prevKey === undefined) delete process.env['STARTER_GOOGLE_API_KEY']; else process.env['STARTER_GOOGLE_API_KEY'] = prevKey; });

describe('the streamed door answers as the model writes', () => {
  it('passes the words through in order, then the whole-reply body', async () => {
    const t = mk({ sse: REPLY });
    const res = await t.post('/v1/starter/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    const out = await lines(res);
    expect(out.map((l) => l.t)).toEqual(['text', 'text', 'text', 'done']);
    expect(out.slice(0, 3).map((l) => l.text).join('')).toBe('Hello, world');
    const done = out[3]!.response;
    expect(done.candidates[0].content).toEqual({ role: 'model', parts: [{ text: 'Hello, world' }] });
    expect(done.candidates[0].finishReason).toBe('STOP');
    expect(done.usageMetadata).toEqual(usage(72, 4));
    expect(done.credits).toEqual({ remaining: 399, spentMicros: priceModelCall(STARTER_MODEL, 72, 4) });
    // the platform key rode the upstream call, and only that call
    expect(t.calls[0]!.url).toMatch(/:streamGenerateContent\?alt=sse$/);
  });

  it('asks Google for exactly what the whole-reply door asks for', async () => {
    const s = mk({ sse: REPLY });
    await (await s.post('/v1/starter/stream')).text();
    const g = mk({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] } });
    await (await g.post('/v1/starter/generate')).text();
    expect(s.calls[0]!.body).toEqual(g.calls[0]!.body);
  });

  it('meters EXACTLY as the whole-reply door for the same usage', async () => {
    const final = usage(11_700, 400);
    const s = mk({ sse: [{ ...textChunk('ok', 1), usageMetadata: usage(11_700, 1) }, { ...textChunk('', 400, { finishReason: 'STOP' }), usageMetadata: final }] });
    const done = (await lines(await s.post('/v1/starter/stream'))).at(-1)!;
    const g = mk({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: final } });
    const gres = await g.post('/v1/starter/generate');
    const gbody = (await gres.json()) as { credits: unknown };
    expect(s.spends).toEqual(g.spends);
    expect(s.spends).toEqual([{ workspace: WS, micros: 4_510, tokens: { inTokens: 11_700, outTokens: 400 } }]);
    expect(done.response.credits).toEqual(gbody.credits);
    expect(gres.headers.get('x-nm-credits-remaining')).toBe(String(done.response.credits.remaining));
  });

  it('charges the thinking tokens at the output rate, on both doors, as Google bills them', async () => {
    const final = { ...usage(11_700, 400), thoughtsTokenCount: 269 };
    const s = mk({ sse: [{ ...textChunk('ok', 1), usageMetadata: usage(11_700, 1) }, { ...textChunk('', 400, { finishReason: 'STOP' }), usageMetadata: final }] });
    await lines(await s.post('/v1/starter/stream'));
    const g = mk({ json: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: final } });
    await g.post('/v1/starter/generate');
    const want = [{ workspace: WS, micros: priceModelCall(STARTER_MODEL, 11_700, 669), tokens: { inTokens: 11_700, outTokens: 669 } }];
    expect(s.spends).toEqual(want);
    expect(g.spends).toEqual(want);
  });

  it('a function-call round arrives intact: the call, its id, its signature', async () => {
    const out = await lines(await mk({ sse: CALL_ROUND }).post('/v1/starter/stream'));
    expect(out.filter((l) => l.t === 'text').map((l) => l.text)).toEqual(['I will', ' check the time now.']);
    const parts = out.at(-1)!.response.candidates[0].content.parts;
    expect(parts).toEqual([
      { text: 'I will check the time now.' },
      { functionCall: { name: 'get_time', args: { zone: 'UTC' }, id: 'call_1' }, thoughtSignature: 'c2lnbmVk' },
    ]);
  });
});

describe('thought summaries, only when the machine asks (the starter-thoughts round)', () => {
  const THINK = { ...ASK, thoughts: true };
  const thinkingConfig = (t: { calls: Array<{ body: unknown }> }): unknown =>
    (t.calls[0]!.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig;

  it('with the flag, both doors ask Google for thought summaries at the same level', async () => {
    const s = mk({ sse: THINK_ROUND });
    await (await s.post('/v1/starter/stream', THINK)).text();
    const g = mk({ json: {} });
    await (await g.post('/v1/starter/generate', THINK)).text();
    expect(thinkingConfig(s)).toEqual({ thinkingLevel: STARTER_THINKING_LEVEL, includeThoughts: true });
    expect(g.calls[0]!.body).toEqual(s.calls[0]!.body);
  });

  it('without the flag, Google gets the request from before the flag, byte for byte (a guard)', async () => {
    // an older machine joins every part's text, so a thought part it never asked for would print in its reply
    const before = JSON.stringify({ contents: ASK.contents, systemInstruction: { parts: [{ text: ASK.system }] }, generationConfig: { thinkingConfig: { thinkingLevel: STARTER_THINKING_LEVEL } } });
    const s = mk({ sse: REPLY });
    await (await s.post('/v1/starter/stream')).text();
    const off = mk({ sse: REPLY });
    await (await off.post('/v1/starter/stream', { ...ASK, thoughts: false })).text();
    const g = mk({ json: {} });
    await (await g.post('/v1/starter/generate')).text();
    expect([s, off, g].map((t) => t.calls[0]!.raw)).toEqual([before, before, before]);
  });

  it('a thoughts flag that is not a boolean is 400, before any model call', async () => {
    const t = mk({ sse: REPLY });
    expect((await t.post('/v1/starter/stream', { ...ASK, thoughts: 'yes' })).status).toBe(400);
    expect(t.calls).toHaveLength(0);
  });

  it('a chunk with a thought and words sends the thought line first, and a chunk with only a thought sends only a thought line', async () => {
    const out = await lines(await mk({ sse: THINK_ROUND }).post('/v1/starter/stream', THINK));
    expect(out.slice(0, -1)).toEqual([
      { t: 'thought', text: '**Reading the ask**' },
      { t: 'thought', text: ' The user wants the time.' },
      { t: 'text', text: 'It is' },
      { t: 'text', text: ' noon.' },
    ]);
    expect(out.at(-1)!.t).toBe('done');
  });

  it('a thought never reaches a text line, and every thought part reaches the thought line, in whatever order one chunk holds its parts (a guard)', async () => {
    const mixed = partsChunk([{ text: 'A', thought: true }, { text: 'one' }, { text: 'B', thought: true }, { text: ' two' }], 4);
    const out = await lines(await mk({ sse: [mixed] }).post('/v1/starter/stream', THINK));
    expect(out.filter((l) => l.t === 'text')).toEqual([{ t: 'text', text: 'one two' }]);
    expect(out.filter((l) => l.t === 'thought')).toEqual([{ t: 'thought', text: 'AB' }]);
  });

  it('done keeps each thought part as Google sent it: apart, unmerged, the signature intact (a guard)', async () => {
    const out = await lines(await mk({ sse: THINK_ROUND }).post('/v1/starter/stream', THINK));
    expect(out.at(-1)!.response.candidates[0].content.parts).toEqual([
      { text: '**Reading the ask**', thought: true },
      { text: ' The user wants the time.', thought: true, thoughtSignature: 'dGhvdWdodA==' },
      { text: 'It is noon.' },
    ]);
  });

  it('two unsigned thought pieces in a row stay two parts in done, as Google streamed them (a guard)', async () => {
    const pieces = [partsChunk([{ text: 'one', thought: true }], 0), partsChunk([{ text: ' two', thought: true }], 0), textChunk('ok', 1), textChunk('', 1, { finishReason: 'STOP' })];
    const out = await lines(await mk({ sse: pieces }).post('/v1/starter/stream', THINK));
    expect(out.filter((l) => l.t === 'thought')).toEqual([{ t: 'thought', text: 'one' }, { t: 'thought', text: ' two' }]);
    expect(out.at(-1)!.response.candidates[0].content.parts).toEqual([{ text: 'one', thought: true }, { text: ' two', thought: true }, { text: 'ok' }]);
  });
});

describe('the guards run before any model call, as on the whole-reply door', () => {
  it('an empty balance is 402 and Google is never called', async () => {
    const t = mk({ sse: REPLY }, { balance: 0 });
    const res = await t.post('/v1/starter/stream');
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe('NO_CREDITS');
    expect(t.calls).toHaveLength(0);
  });

  it('a workspace the caller is not in is 403, before the key', async () => {
    const t = mk({ sse: REPLY }, { members: ['someone-else'] });
    expect((await t.post('/v1/starter/stream')).status).toBe(403);
    expect(t.calls).toHaveLength(0);
  });

  it('an invalid body is 400', async () => {
    expect((await mk({ sse: REPLY }).post('/v1/starter/stream', { workspace: 'not-a-uuid' })).status).toBe(400);
  });

  it('no key is 503, and the local stack keeps the door shut', async () => {
    delete process.env['STARTER_GOOGLE_API_KEY'];
    try { expect((await mk({ sse: REPLY }).post('/v1/starter/stream')).status).toBe(503); }
    finally { process.env['STARTER_GOOGLE_API_KEY'] = 'test-key-never-real'; }
    vi.stubEnv('NM_LOCAL', '1');
    try {
      const res = await mk({ sse: REPLY }).post('/v1/starter/stream');
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('UNAVAILABLE');
    } finally { vi.unstubAllEnvs(); }
  });

  it('an upstream refusal is a 502 and nothing is charged', async () => {
    const t = mk({ status: 500, json: { error: { code: 500 } } });
    const res = await t.post('/v1/starter/stream');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'starter brain call failed', code: 'UPSTREAM', status: 500 });
    expect(t.spends).toHaveLength(0);
  });

  it('an API without this route answers 404 to a signed-in caller — the machine falls back on exactly that', async () => {
    const old = new Hono();
    old.use('/v1/*', async (c, next) => { c.set('actor' as never, { kind: 'human', id: 'u-me' } as never); await next(); });
    old.post('/v1/starter/generate', (c) => c.json({}));
    expect((await old.request('/v1/starter/stream', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});

describe('one charge per model call, whatever happens after the reply began', () => {
  it('a stream that breaks ends in an error line and is charged once, from the usage already reported', async () => {
    const t = mk({ sse: REPLY.slice(0, 2), then: 'error' });
    const out = await lines(await t.post('/v1/starter/stream'));
    expect(out.map((l) => l.t)).toEqual(['text', 'text', 'error']);
    expect(out.at(-1)).toMatchObject({ code: 'UPSTREAM' });
    expect(t.spends).toEqual([{ workspace: WS, micros: priceModelCall(STARTER_MODEL, 72, 3), tokens: { inTokens: 72, outTokens: 3 } }]);
  });

  it('an error event from Google ends the reply the same way', async () => {
    const t = mk({ sse: [REPLY[0]!, { error: { code: 500, message: 'internal', status: 'INTERNAL' } } as StarterChunk] });
    const out = await lines(await t.post('/v1/starter/stream'));
    expect(out.map((l) => l.t)).toEqual(['text', 'error']);
    expect(t.spends).toHaveLength(1);
    expect(t.spends[0]!.tokens).toEqual({ inTokens: 72, outTokens: 1 });
  });

  it('a client that leaves stops the call, and the call is charged once for what the vendor reported', async () => {
    const t = mk({ sse: REPLY.slice(0, 1), then: 'hang' });
    const res = await t.post('/v1/starter/stream');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first)).toEqual({ t: 'text', text: 'Hel' });
    await reader.cancel();
    await t.chargedOnce;
    expect(t.calls[0]!.signal?.aborted).toBe(true);
    expect(t.spends).toEqual([{ workspace: WS, micros: priceModelCall(STARTER_MODEL, 72, 1), tokens: { inTokens: 72, outTokens: 1 } }]);
  });

  it('a client that leaves before the first word: the call runs until the vendor reports, then stops', async () => {
    const t = mk({ sse: REPLY.slice(0, 2), then: 'hang', delayMs: 30 });
    const res = await t.post('/v1/starter/stream');
    await res.body!.cancel(); // gone before any chunk exists
    await t.chargedOnce;
    expect(t.calls[0]!.signal?.aborted).toBe(true);
    expect(t.spends).toHaveLength(1);
    expect(t.spends[0]!.tokens.inTokens).toBe(72); // never a free prompt
  });
});

describe('the pure parts', () => {
  it('the grace timer stops a call that never reports, and still settles once', async () => {
    let aborted = false;
    const settled: unknown[] = [];
    let upstreamCtl!: ReadableStreamDefaultController<Uint8Array>;
    const up = new ReadableStream<Uint8Array>({ start(c) { upstreamCtl = c; } });
    let done!: () => void;
    const finished = new Promise<void>((r) => { done = r; });
    const body = starterReplyStream({
      upstream: up,
      abortUpstream: () => { aborted = true; upstreamCtl.error(new DOMException('aborted', 'AbortError')); },
      settle: async (u) => { settled.push(u); done(); return { remaining: 1, spentMicros: 0 }; },
      graceMs: 10,
    });
    await body.cancel();
    await finished;
    expect(aborted).toBe(true);
    expect(settled).toEqual([undefined]);
  });

  it('a charge that fails is said, never passed off as an answer', async () => {
    const body = starterReplyStream({
      upstream: sseBody(REPLY),
      abortUpstream: () => {},
      settle: async () => { throw new Error('pool exhausted'); },
      log: () => {},
    });
    const out = (await new Response(body).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { t: string; code?: string });
    expect(out.at(-1)).toMatchObject({ t: 'error', code: 'INTERNAL' });
    expect(out.some((l) => l.t === 'done')).toBe(false);
  });

  it('the SSE parser survives CRLF, reads cut mid-line, and a character cut mid-byte', async () => {
    const chunks = [textChunk('héllo wörld ✓ ', 3), textChunk('naïve — done', 6, { finishReason: 'STOP' })];
    const seen: StarterChunk[] = [];
    for await (const c of sseChunks(sseBody(chunks, { pieces: 7 }))) seen.push(c);
    expect(seen).toEqual(chunks);
  });

  it('the assembly merges plain text, keeps signed parts apart, and drops empty plain parts', () => {
    const a = starterAssembly();
    a.add(textChunk('a', 1));
    a.add({ candidates: [{ content: { parts: [{ text: 'b' }, { text: '' }] } }] });
    a.add({ candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'sig' }] }, finishReason: 'STOP' }] });
    a.add({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] });
    const r = a.response() as { candidates: Array<{ content: { parts: unknown[] }; finishReason: string }> };
    expect(r.candidates[0]!.content.parts).toEqual([{ text: 'ab' }, { text: '', thoughtSignature: 'sig' }, { text: 'thinking', thought: true }]);
    expect(r.candidates[0]!.finishReason).toBe('STOP');
    // a thought part is never words for the bubble: it comes back apart
    expect(starterAssembly().add({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'shown' }] } }] })).toEqual({ text: 'shown', thought: 'hidden' });
  });

  it('a blocked prompt (no candidates) assembles to Google\'s own shape', () => {
    const a = starterAssembly();
    a.add({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: usage(40, 0) });
    expect(a.response()).toEqual({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: usage(40, 0) });
  });
});
