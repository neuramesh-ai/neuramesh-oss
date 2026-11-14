// CHAT RECALL ASKS AS THE AGENT ANSWERING (the Cloud Run feature suite, 2026-10-30). A chat turn's
// recall tool posted /v1/recall as the placeholder actor {kind:'agent', id:'chat'}. A machine token
// may only claim an agent of its own workspace (machine-auth.ts machineMayClaim), so nm-api refused
// the claim and every chat answer read "recall is unavailable right now".
// Run from apps/desktop: pnpm exec tsx --test src/main/host/chatsupport-recall.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeChatSupport } from './chatsupport';

test('recallFor posts /v1/recall as the answering agent, never a placeholder', async () => {
  const posts: Array<{ path: string; actor: { kind: string; id: string; role?: string }; body: Record<string, unknown> }> = [];
  const support = makeChatSupport({
    post: async (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => {
      posts.push({ path, actor, body: body as Record<string, unknown> });
      return new Response(JSON.stringify({ hits: [{ body: 'the launch is Friday', channel: 'general', createdAt: '2026-10-30T00:00:00Z' }] }), { status: 200 });
    },
    db: {} as never,
    agents: new Map(),
    apiGet: async () => null,
    discoverSkills: async () => [],
  } as never);
  const out = await support.recallFor('ws-1', 'c-1', 'launch', { kind: 'agent', id: 'a-sol', role: 'worker' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.path, '/v1/recall');
  assert.deepEqual(posts[0]!.actor, { kind: 'agent', id: 'a-sol', role: 'worker' });
  // D15: the channel names the project nm-api reads, so recall never crosses into another project
  assert.deepEqual(posts[0]!.body, { workspace: 'ws-1', channel: 'c-1', query: 'launch', k: 6 });
  assert.match(out, /the launch is Friday/);
});

test('a refused recall still says so in words the model can use', async () => {
  const support = makeChatSupport({
    post: async () => new Response('{"error":"unknown machine token"}', { status: 401 }),
    db: {} as never, agents: new Map(), apiGet: async () => null, discoverSkills: async () => [],
  } as never);
  assert.equal(await support.recallFor('ws-1', 'c-1', 'x', { kind: 'agent', id: 'a-sol' }), 'recall is unavailable right now');
});
