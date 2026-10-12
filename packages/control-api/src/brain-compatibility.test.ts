import { afterEach, expect, it, vi } from 'vitest';
import { brainArtifactInline } from './brain-compatibility';
import { brainIngress } from './brain-ingress';
import { createApp } from './app';
import { MemoryStore } from './store';

afterEach(() => vi.unstubAllEnvs());
it('retains exact legacy text and binary copies until cloud-only readers are enabled', () => {
  vi.stubEnv('NM_BRAIN_CLOUD_ONLY_ARTIFACTS', '0');
  expect(brainArtifactInline(Buffer.from('héllo'), 'text/plain', 'workspace-a')).toBe('héllo');
  expect(brainArtifactInline(Buffer.from([0, 255, 19]), 'image/png', 'workspace-a')).toBe('data:image/png;base64,AP8T');
  expect(() => brainArtifactInline(Buffer.alloc(400_001), 'text/plain', 'workspace-a')).toThrow(/older artifact readers/);
  expect(() => brainArtifactInline(Buffer.alloc(300_000), 'image/png', 'workspace-a')).toThrow(/older artifact readers/);
  vi.stubEnv('NM_BRAIN_CLOUD_ONLY_ARTIFACTS', '1');
  expect(brainArtifactInline(Buffer.alloc(16 * 1024 * 1024), 'image/png', 'workspace-a')).toBeNull();
});
it('never puts private Code bytes in workspace replicas and scopes the reader rollout', () => {
  vi.stubEnv('NM_BRAIN_CLOUD_ONLY_ARTIFACTS', '0');
  vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES', ' workspace-a ');
  expect(brainArtifactInline(Buffer.from('private'), 'text/plain', 'workspace-a', true)).toBeNull();
  expect(() => brainArtifactInline(Buffer.from('private'), 'text/plain', 'workspace-b', true)).toThrow(/compatible readers/);
  expect(brainArtifactInline(Buffer.from('shared'), 'text/plain', 'workspace-b')).toBe('shared');
});
it('exposes only brain routes and health while preserving the existing authentication gate', async () => {
  vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '0');
  const app = createApp(new MemoryStore());
  const call = brainIngress(r => app.fetch(r), async () => {});
  for (const path of ['/v1/commands', '/auth/clerk', '/v1/messages', '/v1/brain-other', '/healthz']) {
    expect((await call(new Request(`https://relay.test${path}`))).status).toBe(404);
  }
  const denied = await call(new Request('https://relay.test/v1/brain/threads/one?workspace=two', {
    headers: { 'x-nm-actor': JSON.stringify({ kind: 'human', id: crypto.randomUUID() }) },
  }));
  expect(denied.status).toBe(401);
  expect(denied.headers.get('cache-control')).toBe('private, no-store');
  expect((await call(new Request('https://relay.test/brain-healthz'))).status).toBe(200);
  const notReady = brainIngress(r => app.fetch(r), async () => { throw new Error('database unavailable'); });
  expect((await notReady(new Request('https://relay.test/brain-healthz'))).status).toBe(503);
});
