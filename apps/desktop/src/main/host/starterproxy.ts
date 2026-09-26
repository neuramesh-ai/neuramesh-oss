// THE METERED LANE'S CLIENT — the machine's two doors to control-api's starter proxy
// (packages/control-api credits.ts + starter-stream.ts). The platform key lives there; this sends
// the turn and reads the answer. Both doors answer with the SAME body (Google's response plus
// `credits`), so the tool loop in orchturn.ts cannot tell which one served a round.
//
// The streamed door is used only where someone watches (a live bubble), and only against an API
// that has it: an older API answers 404, and the turn goes to the whole-reply door without a word,
// then skips the probe for ten minutes. Nothing breaks when the machine is newer than the API.
import { apiAuthHeaders } from '../apiauth';
import { NO_CREDITS_ERROR } from '../computenotice';

export interface StarterCall { apiUrl: string; workspace: string; actorId: string; contents: any[]; config: any }

const OUT_OF_CREDITS = `${NO_CREDITS_ERROR}: add credits in Credits, or connect your own brain in Settings`;

const proxyBody = (a: StarterCall): string => JSON.stringify({
  workspace: a.workspace,
  contents: a.contents,
  system: a.config?.systemInstruction,
  tools: a.config?.tools,
});

/** the whole-reply door: control-api holds the key, guards the balance, and records the spend. It
 *  answers with Google's own response body, so the caller's loop is unchanged. A 402 surfaces as a
 *  readable refusal rather than an empty turn — running out of credits is a thing to say, not a
 *  thing to fail silently at. */
export async function starterGenerate(a: StarterCall): Promise<any> {
  const res = await fetch(`${a.apiUrl}/v1/starter/generate`, {
    method: 'POST',
    headers: await apiAuthHeaders(a.apiUrl, { kind: 'human', id: a.actorId }),
    body: proxyBody(a),
  });
  if (res.status === 402) throw new Error(OUT_OF_CREDITS);
  if (!res.ok) throw new Error(`starter brain unavailable (${res.status})`);
  return res.json();
}

/** how long a 404 from an older API sends every call to the whole-reply door before we ask again */
export const STREAM_RECHECK_MS = 10 * 60_000;
let streamMissingUntil = 0;
/** tests only: forget that an older API answered 404 */
export function resetStarterStreamProbe(): void { streamMissingUntil = 0; }

/** the streamed door: `onText` gets each text delta as the model writes it, in order. Same errors,
 *  same answer as the whole-reply door. */
export async function starterStream(a: StarterCall & { onText: (delta: string) => void }): Promise<any> {
  if (Date.now() < streamMissingUntil) return starterGenerate(a);
  const res = await fetch(`${a.apiUrl}/v1/starter/stream`, {
    method: 'POST',
    // identity: a compressing hop would hold the small lines back until it had a block to squeeze
    headers: { ...(await apiAuthHeaders(a.apiUrl, { kind: 'human', id: a.actorId })), accept: 'application/x-ndjson', 'accept-encoding': 'identity' },
    body: proxyBody(a),
  });
  if (res.status === 404) {
    streamMissingUntil = Date.now() + STREAM_RECHECK_MS;
    await res.body?.cancel().catch(() => {});
    return starterGenerate(a);
  }
  if (res.status === 402) throw new Error(OUT_OF_CREDITS);
  if (!res.ok || !res.body) throw new Error(`starter brain unavailable (${res.status})`);
  return readStarterStream(res.body, a.onText);
}

/** one NDJSON line: words go to onText, the answer comes back, a failure is thrown. An unknown
 *  line type is skipped, so the server can add one without breaking an older machine. */
function readLine(line: string, onText: (delta: string) => void): { answer: unknown } | null {
  const msg = JSON.parse(line) as { t?: string; text?: string; response?: unknown; code?: string };
  if (msg.t === 'error') throw new Error(`starter brain unavailable (stream ${msg.code ?? 'error'})`);
  if (msg.t === 'done') return { answer: msg.response };
  if (msg.t === 'text' && msg.text) {
    try { onText(msg.text); } catch { /* a live bubble is never worth the turn */ }
  }
  return null;
}

/** the NDJSON answer: `text` lines to onText, then the `done` body. Decoded as a stream, because
 *  a network read may cut a multi-byte character in two. */
export async function readStarterStream(body: ReadableStream<Uint8Array>, onText: (delta: string) => void): Promise<any> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? `${dec.decode()}\n` : dec.decode(value, { stream: true });
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const end = line ? readLine(line, onText) : null;
        if (end) return end.answer;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error('starter brain unavailable (the stream ended before the answer)');
}
