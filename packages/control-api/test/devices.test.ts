import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const actor = (kind: 'human' | 'agent', id: string) => JSON.stringify(kind === 'agent' ? { kind, id, role: 'worker' } : { kind, id });

function register(actorHeader: string, body: unknown) {
  return app.request('/v1/devices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': actorHeader }, body: JSON.stringify(body) });
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('/v1/devices', () => {
  it('a human registers a push token; it is retrievable for fan-out', async () => {
    const res = await register(actor('human', 'alice'), { platform: 'ios', token: 'ExpoTok[abc]' });
    expect(res.status).toBe(200);
    expect(await store.devicesForUsers(['alice'])).toEqual([{ userId: 'alice', token: 'ExpoTok[abc]', platform: 'ios' }]);
  });

  it('re-registering the same token is idempotent', async () => {
    await register(actor('human', 'alice'), { platform: 'ios', token: 'T' });
    await register(actor('human', 'alice'), { platform: 'android', token: 'T' });
    expect(await store.devicesForUsers(['alice'])).toEqual([{ userId: 'alice', token: 'T', platform: 'android' }]);
  });

  it('rejects a bad platform or a missing token', async () => {
    expect((await register(actor('human', 'alice'), { platform: 'web', token: 'T' })).status).toBe(400);
    expect((await register(actor('human', 'alice'), { platform: 'ios' })).status).toBe(400);
  });

  it('is human-only — an agent daemon cannot register a device', async () => {
    expect((await register(actor('agent', 'rex'), { platform: 'ios', token: 'T' })).status).toBe(403);
    expect(await store.devicesForUsers(['rex'])).toHaveLength(0);
  });

  it('remove drops the token (sign-out)', async () => {
    await register(actor('human', 'alice'), { platform: 'ios', token: 'T' });
    const res = await app.request('/v1/devices/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': actor('human', 'alice') },
      body: JSON.stringify({ token: 'T' }),
    });
    expect(res.status).toBe(200);
    expect(await store.devicesForUsers(['alice'])).toHaveLength(0);
  });
});
