// A2A 1.0 delegation to a remote agent — extracted from agents.ts (track B1).

// A2A JSON-RPC client for delegating a task to a remote (external) agent. We send
// the task as a Message and poll tasks/get until terminal; results come back as
// A2A Artifact objects. Only the task text + requirements leave the machine —
// never code or secrets (§1.3 structural: there's no worktree to read).
export interface A2APart { kind?: string; text?: string; data?: unknown; file?: { uri?: string; name?: string } }

export interface A2ATask { id?: string; status?: { state?: string; message?: { parts?: A2APart[] } }; artifacts?: Array<{ name?: string; parts?: A2APart[] }> }

export async function a2aSend(endpointUrl: string, prompt: string, contextId: string): Promise<A2ATask> {
  const rpc = (method: string, params: unknown) => fetch(endpointUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const res = await rpc('message/send', { message: { role: 'user', kind: 'message', messageId: crypto.randomUUID(), contextId, parts: [{ kind: 'text', text: prompt }] } });
  if (!res.ok) throw new Error(`A2A endpoint returned ${res.status}`);
  const j = (await res.json()) as { error?: { message?: string }; result?: A2ATask };
  if (j.error) throw new Error(`A2A error: ${j.error.message ?? 'unknown'}`);
  let result = j.result ?? {};
  const terminal = (s?: string) => !s || s === 'completed' || s === 'failed' || s === 'canceled' || s === 'rejected';
  const deadline = Date.now() + 180_000;
  while (result.id && !terminal(result.status?.state) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const pr = await rpc('tasks/get', { id: result.id });
    if (!pr.ok) break;
    const pj = (await pr.json()) as { result?: A2ATask };
    if (pj.result) result = pj.result;
  }
  return result;
}

// map A2A Artifact parts to task-submit artifacts (≥1, since submit requires it).
export function a2aArtifactsToSubmit(result: A2ATask): Array<{ kind: string; name: string; content: string }> {
  const out: Array<{ kind: string; name: string; content: string }> = [];
  for (const a of result.artifacts ?? []) {
    for (const p of a.parts ?? []) {
      if (p.kind === 'text' && p.text) out.push({ kind: 'doc', name: a.name ?? `a2a-${out.length + 1}.md`, content: p.text });
      else if (p.kind === 'data' && p.data != null) out.push({ kind: 'test_report', name: a.name ?? `a2a-${out.length + 1}.json`, content: JSON.stringify(p.data) });
    }
  }
  if (!out.length) {
    const msg = (result.status?.message?.parts ?? []).filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
    out.push({ kind: 'doc', name: 'a2a-result.md', content: msg || 'the remote agent returned no artifacts' });
  }
  return out;
}
