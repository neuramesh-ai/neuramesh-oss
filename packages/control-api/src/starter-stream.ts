// POST /v1/starter/stream — the metered proxy, streamed (the streamed-brains round, 2026-09-25).
//
// The same call as /v1/starter/generate, behind the same guards and priced by the same function,
// but the reply leaves as the model writes it: one NDJSON line per text delta, then ONE terminal
// line. A chunk that carries a thought summary (only when the caller asked with `thoughts`) sends
// it first, on its own `thought` line, so the words never hold a thought. `done` carries the exact
// body the whole-reply door returns (Google's response, assembled here, plus `credits`), so a
// machine's tool loop cannot tell the two doors apart. `error` means the call failed after the
// reply began. The platform key never leaves this process.
//
// THE CHARGE IS MADE ONCE, and always after a model call began: `settle` runs exactly once, after
// the upstream ends, fails, or is stopped, with the vendor's LAST reported usage (Gemini sends
// cumulative counts on every chunk, the prompt count from the first). A client that leaves stops
// the call, but only once those numbers are in hand, so a disconnect is never a free prompt.
//
// Dependencies arrive as a parameter object (credits.ts wires them), so this module imports only
// types from credits.ts and the two never form a runtime cycle.
import type { Context, Env, Hono } from 'hono';
import type { Actor } from '@neuramesh/shared';
import type { GeminiUsage, Ledger, StarterFetch } from './credits';

type Part = Record<string, unknown> & { text?: string; thought?: boolean };
type Candidate = Record<string, unknown> & { content?: { parts?: Part[]; role?: string } };
export type StarterChunk = Record<string, unknown> & { candidates?: Candidate[]; usageMetadata?: GeminiUsage; error?: unknown };
export type StarterCredits = { remaining: number; spentMicros: number };

/** Google's SSE body → one parsed JSON chunk per event. Lines may end in CRLF (Google's do), and
 *  a read may split a line or a multi-byte character, so text is decoded as a stream. */
export async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<StarterChunk> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      if (done) buf += '\n\n'; // an event with no trailing blank line still counts
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        else if (line === '' && data.length) { const one = data.join('\n'); data = []; yield JSON.parse(one) as StarterChunk; }
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {}); // a consumer that stopped early stops the download too
  }
}

const plainText = (p: Part): boolean => typeof p.text === 'string' && Object.keys(p).length === 1;

/** The chunks, folded back into ONE response in Google's own shape. Parts keep their order; only
 *  adjacent plain-text parts merge, so a function call keeps its `id` and a part keeps its
 *  `thoughtSignature` (Gemini 3 refuses a tool round whose call lost its signature). A plain empty
 *  text part carries nothing and is dropped. Newest wins for every other field. */
export function starterAssembly() {
  const parts: Part[] = [];
  let cand: Record<string, unknown> | null = null;
  let usage: GeminiUsage | undefined;
  const top: Record<string, unknown> = {};
  return {
    /** fold one chunk in; answers the words it carried and, apart from them, its thought summary.
     *  `thought` is read per part, because one chunk can carry both */
    add(chunk: StarterChunk): { text: string; thought: string } {
      const { candidates, usageMetadata, ...rest } = chunk;
      Object.assign(top, rest);
      if (usageMetadata) usage = { ...usage, ...usageMetadata };
      const first = candidates?.[0];
      if (!first) return { text: '', thought: '' };
      const { content, ...fields } = first;
      cand = { ...cand, ...fields };
      let text = '';
      let thought = '';
      for (const p of content?.parts ?? []) {
        if (typeof p.text === 'string' && !p.thought) text += p.text;
        if (typeof p.text === 'string' && p.thought) thought += p.text;
        if (plainText(p) && !p.text) continue;
        const last = parts[parts.length - 1];
        if (last && plainText(p) && plainText(last)) last.text = `${last.text ?? ''}${p.text ?? ''}`;
        else parts.push({ ...p });
      }
      return { text, thought };
    },
    usage: (): GeminiUsage | undefined => usage,
    response: (): Record<string, unknown> => ({
      ...(cand || parts.length ? { candidates: [{ content: { role: 'model', parts }, ...cand }] } : {}),
      ...top,
      ...(usage ? { usageMetadata: usage } : {}),
    }),
  };
}

export interface ReplyStreamOpts {
  upstream: ReadableStream<Uint8Array>;
  /** stops the vendor call (the fetch's AbortController) */
  abortUpstream: () => void;
  /** THE one charge, from the vendor's last reported usage. Called exactly once. */
  settle: (usage: GeminiUsage | undefined) => Promise<StarterCredits>;
  /** keeps the platform's function alive until the charge lands (Vercel's waitUntil) */
  keepAlive?: (work: Promise<unknown>) => void;
  /** after the client leaves before the first chunk: how long the call may run to report its numbers */
  graceMs?: number;
  log?: (line: string) => void;
}

/** the NDJSON body: per chunk `{"t":"thought"}` then `{"t":"text"}`, each only when the chunk carried
 *  one, then `{"t":"done","response":…}` or `{"t":"error"}` */
export function starterReplyStream(o: ReplyStreamOpts): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const acc = starterAssembly();
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  let gone = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const send = (line: object): void => {
    if (gone || !ctl) return;
    try { ctl.enqueue(enc.encode(`${JSON.stringify(line)}\n`)); } catch { gone = true; }
  };
  const pump = async (): Promise<void> => {
    let failure: string | null = null;
    try {
      for await (const chunk of sseChunks(o.upstream)) {
        if (chunk.error) { failure = 'UPSTREAM'; break; }
        const { text, thought } = acc.add(chunk);
        // the client left and the vendor's numbers are in hand: stop the call, then charge it
        if (gone) { o.abortUpstream(); failure = 'CLIENT_GONE'; break; }
        if (thought) send({ t: 'thought', text: thought });
        if (text) send({ t: 'text', text });
      }
    } catch { failure = gone ? 'CLIENT_GONE' : 'UPSTREAM'; }
    clearTimeout(grace);
    let credits: StarterCredits | null = null;
    try { credits = await o.settle(acc.usage()); } catch (e) {
      const u = acc.usage();
      o.log?.(`starter_stream_charge_failed in=${u?.promptTokenCount ?? 0} out=${u?.candidatesTokenCount ?? 0} thoughts=${u?.thoughtsTokenCount ?? 0}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!credits) send({ t: 'error', error: 'the charge for this call did not record', code: 'INTERNAL' });
    else if (failure) send({ t: 'error', error: 'starter brain call failed', code: failure });
    else send({ t: 'done', response: { ...acc.response(), credits } });
    if (!gone) try { ctl?.close(); } catch { /* the reader already left */ }
  };
  return new ReadableStream<Uint8Array>({
    // two statements, not `keepAlive?.(pump())`: an optional call skips its arguments, so with no
    // keepAlive the pump would never start
    start(c) { ctl = c; const work = pump(); o.keepAlive?.(work); },
    cancel() {
      gone = true;
      if (acc.usage()) o.abortUpstream();
      else grace = setTimeout(o.abortUpstream, o.graceMs ?? 30_000);
    },
  });
}

/** Vercel's waitUntil, reached the way @vercel/functions reaches it. Off Vercel it does nothing,
 *  and nothing is needed: a Node server keeps running the pump on its own. */
function vercelWaitUntil(work: Promise<unknown>): void {
  const holder = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[Symbol.for('@vercel/request-context')];
  holder?.get?.()?.waitUntil?.(work);
}

type Preflight<B> = { refusal: Response } | { ledger: Ledger; body: B & { workspace: string }; key: string };
export interface StarterStreamDeps<B> {
  preflight: (c: Context) => Promise<Preflight<B>>;
  request: (b: B) => Record<string, unknown>;
  charge: (ledger: Ledger, workspace: string, usage: GeminiUsage | undefined) => Promise<StarterCredits>;
  fetchFn: StarterFetch;
  modelUrl: string;
  graceMs?: number;
}

export function starterStreamRoute<E extends Env & { Variables: { actor: Actor } }, B>(app: Hono<E>, deps: StarterStreamDeps<B>): void {
  app.post('/v1/starter/stream', async (c) => {
    const pre = await deps.preflight(c as unknown as Context);
    if ('refusal' in pre) return pre.refusal;
    const upstream = new AbortController();
    const res = await deps.fetchFn(`${deps.modelUrl}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': pre.key },
      body: JSON.stringify(deps.request(pre.body)),
      signal: upstream.signal,
    }).catch(() => null);
    // no reply began, so nothing is charged: the whole-reply door's answer, word for word
    if (!res?.ok || !res.body) {
      await res?.body?.cancel().catch(() => {});
      return c.json({ error: 'starter brain call failed', code: 'UPSTREAM', status: res?.status ?? 0 }, 502);
    }
    const workspace = pre.body.workspace;
    const body = starterReplyStream({
      upstream: res.body,
      abortUpstream: () => upstream.abort(),
      settle: (usage) => deps.charge(pre.ledger, workspace, usage),
      keepAlive: vercelWaitUntil,
      graceMs: deps.graceMs,
      log: (line) => console.error(`${line} workspace=${workspace}`),
    });
    // no-transform + identity: nothing between here and the machine may buffer the lines to compress them
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
  });
}
