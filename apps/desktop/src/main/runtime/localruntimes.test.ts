// A cloud machine serves what the workspace's stored API keys unlock (2026-09-25). Before this the
// ladder read only logins and env keys, so a person who typed a key in the Keys step got agents
// that every host refused: "No machine available to me can serve Claude".
// Run from apps/desktop: pnpm exec tsx --test src/main/runtime/localruntimes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineRuntimes, runtimeProbe, workspaceKeyProbe } from './localruntimes';

const keys = (...providers: string[]) => async (p: string) => providers.includes(p);
const none = async (): Promise<string[]> => [];

test('a laptop serves only its own logins and keys: a stored credential never made it capable', async () => {
  const r = await machineRuntimes({ cloud: false, hasKey: keys('anthropic', 'openai'), local: async () => ['gemini'] });
  assert.deepEqual(r, ['gemini']);
});

test('a cloud machine also serves each provider the workspace holds an API key for', async () => {
  assert.deepEqual(await machineRuntimes({ cloud: true, hasKey: keys('anthropic'), local: none }), ['claude-code']);
  assert.deepEqual(await machineRuntimes({ cloud: true, hasKey: keys('openai'), local: async () => ['gemini'] }), ['codex', 'gemini']);
});

test('a probe that fails counts as no key, never as a refusal of the rest', async () => {
  const flaky = async (p: string) => { if (p === 'openai') throw new Error('offline'); return p === 'anthropic'; };
  assert.deepEqual(await machineRuntimes({ cloud: true, hasKey: flaky, local: none }), ['claude-code']);
  assert.deepEqual(await machineRuntimes({ cloud: true, hasKey: keys(), local: async () => { throw new Error('no cli'); } }), []);
});

test('a key added after boot serves the next message: the host re-probes before it refuses', async () => {
  let stored: string[] = [];
  let t = 0;
  let probes = 0;
  const probe = runtimeProbe({ cloud: true, hasKey: async (p) => { probes++; return stored.includes(p); }, local: none, minGapMs: 30_000, now: () => t });
  assert.deepEqual(await probe.refresh(), []);
  stored = ['anthropic'];
  t = 40_000; // the last probe is stale
  assert.deepEqual(await probe.ensure('claude-code'), ['claude-code']);
  assert.deepEqual(probe.current(), ['claude-code']);
  const before = probes;
  assert.deepEqual(await probe.ensure('claude-code'), ['claude-code'], 'a runtime it has needs no probe');
  t = 45_000;
  assert.deepEqual(await probe.ensure('codex'), ['claude-code'], 'within the gap it answers from the last probe');
  assert.equal(probes, before, 'no probe inside the gap');
});

test('a laptop never re-probes on a refusal: its logins refresh on the register beat', async () => {
  let calls = 0;
  const probe = runtimeProbe({ cloud: false, hasKey: keys(), local: async () => { calls++; return []; }, now: () => 1e9 });
  await probe.refresh();
  assert.deepEqual(await probe.ensure('claude-code'), []);
  assert.equal(calls, 1);
});

test('the credential probe counts only a stored API key, and a refusal is no key', async () => {
  const real = globalThis.fetch;
  const replies: Record<string, { status: number; body: unknown }> = {
    anthropic: { status: 200, body: { authMode: 'apikey', token: 'sk-test' } },
    openai: { status: 200, body: { authMode: 'subscription', token: null } },
    gemini: { status: 403, body: { code: 'NOT_PERMITTED' } },
  };
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    seen.push(`${u.pathname} ws=${u.searchParams.get('workspace')} auth=${(init?.headers as Record<string, string>)['authorization']}`);
    const r = replies[u.searchParams.get('provider') ?? ''] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  try {
    const hasKey = workspaceKeyProbe('https://api.test', 'ws-1', async () => ({ authorization: 'Bearer nmm_machine' }));
    assert.equal(await hasKey('anthropic'), true);
    assert.equal(await hasKey('openai'), false, 'a subscription marker is not a key the machine can use');
    assert.equal(await hasKey('gemini'), false);
    assert.equal(seen[0], '/v1/credentials/resolve ws=ws-1 auth=Bearer nmm_machine');
  } finally { globalThis.fetch = real; }
});
