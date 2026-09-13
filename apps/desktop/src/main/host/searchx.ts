// ONE search_x implementation (marketing-os round) — the orchestrator registry, the chat
// registry and the worker-leg bus all had (or wanted) their own copy of the same fetch +
// honesty rules; a drifted copy is how one surface starts guessing engagement numbers while
// another refuses. The wire contract lives in control-api (/v1/x/search, docs/design/
// marketing-channel-2026-07 P2); this is the agent-facing rendering of it.

export type ApiGetFn = (path: string, actor: { kind: string; id: string; role?: string }) => Promise<{
  status: number; ok: boolean; json: () => Promise<unknown>; text: () => Promise<string>;
}>;

export interface SearchXWhere { workspaceId: string; channelId: string }

export async function searchXText(
  apiGet: ApiGetFn,
  actor: { kind: string; id: string; role?: string },
  where: SearchXWhere,
  query: string,
  max?: number,
): Promise<string> {
  const qs = new URLSearchParams({ workspace: where.workspaceId, channel: where.channelId, q: query, max: String(max ?? 10) });
  const res = await apiGet(`/v1/x/search?${qs.toString()}`, actor);
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    // a dead grant (X refused to renew the token) is not "nothing was ever connected" —
    // the fix is a human re-running Connect, and the agent's job is to say exactly that
    if (body.code === 'RECONNECT_REQUIRED') return `${body.error ?? 'the room’s X connection expired'}. Tell the human plainly: reconnect X (Twitter) from Connections — it takes under a minute in the browser, and reads and publishing are down until then. Do NOT retry this search, do NOT substitute a web search, and never fill the gap with guessed posts or numbers.`;
    return 'No X account is connected for this room — say so plainly and point the human at Connections › X (Twitter) to connect one. Do NOT substitute a web search and do NOT estimate engagement numbers.';
  }
  if (res.status === 501) return 'X connecting is not configured on this server — say so; there is nothing the human can do from here.';
  if (!res.ok) return `X search failed (${res.status}): ${(await res.text()).slice(0, 200)}. Report the failure; never fill the gap with guessed posts or numbers.`;
  const { hits } = (await res.json()) as { hits: Array<{ text: string; authorHandle: string | null; authorName: string | null; createdAt: string | null; metrics: { replies: number; reposts: number; likes: number; quotes: number; impressions: number | null } | null; url: string }> };
  if (!hits.length) return `No posts on X match "${query}" in the last 7 days. Say that — it is a real answer.`;
  return hits.map((h) => {
    const m = h.metrics;
    const eng = m ? `${m.likes} likes · ${m.reposts} reposts · ${m.replies} replies${m.impressions != null ? ` · ${m.impressions} impressions` : ''}` : 'engagement not returned';
    return `${h.authorHandle ?? '(unknown)'}${h.authorName ? ` (${h.authorName})` : ''} · ${h.createdAt?.slice(0, 10) ?? ''}\n${h.text}\n${eng}\n${h.url}`;
  }).join('\n---\n');
}
