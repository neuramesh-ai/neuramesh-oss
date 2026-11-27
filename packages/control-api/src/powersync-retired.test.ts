import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { MemoryStore } from './store';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('production retires the old sync mint and JWKS routes without contacting Clerk or PowerSync', async () => {
  vi.stubEnv('NM_DEPLOYMENT', 'production');
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected outbound request'));
  const app = createApp(new MemoryStore());
  for (const [method, path] of [['POST', '/auth/clerk/token'], ['POST', '/v1/machines/sync-token'], ['GET', '/v1/sync-jwks']] as const) {
    const response = await app.request(path, { method });
    expect(response.status, path).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'SYNC_RETIRED' });
  }
  expect(outbound).not.toHaveBeenCalled();
});
