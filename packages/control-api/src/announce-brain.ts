// The public door's one model turn (docs/design/release-drafts-2026-09 §5.3): the Starter brain,
// called from this process with the platform key. A DEVIATION, said plainly: credits.ts meters
// every Starter call against a workspace, and a stranger's draft has none yet. The door's own caps
// (per email, per address, per day) are the budget here, and the row records what was made.
import { STARTER_MODEL, STARTER_THINKING_LEVEL } from '@neuramesh/shared';

export async function starterText(system: string, user: string, fetchFn: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const key = env['STARTER_GOOGLE_API_KEY'];
  if (!key) throw new Error('starter brain not configured');
  const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${STARTER_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { thinkingConfig: { thinkingLevel: STARTER_THINKING_LEVEL }, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(50_000),
  });
  const payload = (await res.json().catch(() => ({}))) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!res.ok) throw new Error(`starter brain call failed (${res.status})`);
  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new Error('starter brain answered with no text');
  return text;
}

/** the JSON the turn must answer with; the job renders the brief from it, so the shape never drifts */
export interface DraftAnswer {
  verdict: 'feature' | 'improvement' | 'fix' | 'none';
  title: string;
  why: string;
  audience: string;
  assets: string;
  gaps: string;
  posts: Array<{ platform: string; body: string; imageBrief?: string }>;
}

export function parseDraftAnswer(text: string): DraftAnswer | null {
  const raw = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let j: unknown;
  try { j = JSON.parse(raw); } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    try { j = JSON.parse(m[0]); } catch { return null; }
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const verdict = String(o['verdict'] ?? 'none').toLowerCase();
  if (!['feature', 'improvement', 'fix', 'none'].includes(verdict)) return null;
  const str = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const posts = Array.isArray(o['posts']) ? (o['posts'] as unknown[]).flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const q = p as Record<string, unknown>;
    return typeof q['body'] === 'string' && q['body'].trim() ? [{ platform: String(q['platform'] ?? 'x').toLowerCase(), body: q['body'].trim(), ...(typeof q['imageBrief'] === 'string' && q['imageBrief'].trim() ? { imageBrief: q['imageBrief'].trim() } : {}) }] : [];
  }) : [];
  return { verdict: verdict as DraftAnswer['verdict'], title: str('title'), why: str('why'), audience: str('audience'), assets: str('assets'), gaps: str('gaps'), posts };
}
