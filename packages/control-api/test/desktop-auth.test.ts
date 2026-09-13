import { DESKTOP_AUTH_TTL_MS } from '@neuramesh/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// The desktop sign-in handoff (device-code style) that replaces the broken 127.0.0.1
// loopback OAuth on production Clerk. These cover the server-side rendezvous + its security
// invariants; the Clerk-token verification in /auth/desktop/complete is exercised by the
// live e2e (it needs a real signed-in token), not here.
describe('desktop sign-in handoff (device-code)', () => {
  it('start → pending → complete → done, and the row is single-use', async () => {
    const store = new MemoryStore();
    await store.startDesktopAuth({ nonce: 'n1', pollSecretHash: 'h1', ttlSeconds: 300 });
    expect(await store.claimDesktopAuth('n1', 'h1')).toEqual({ status: 'pending' });

    expect((await store.completeDesktopAuth('n1', { userId: 'u1', email: 'a@b.c', sessionId: 's1' })).ok).toBe(true);
    const done = await store.claimDesktopAuth('n1', 'h1');
    expect(done.status).toBe('done');
    expect(done.result).toEqual({ userId: 'u1', email: 'a@b.c', sessionId: 's1' });

    // claimed once, then gone — a replay can't re-read the session
    expect(await store.claimDesktopAuth('n1', 'h1')).toEqual({ status: 'gone' });
  });

  it('a wrong poll secret never reveals the session (a leaked nonce alone is useless)', async () => {
    const store = new MemoryStore();
    await store.startDesktopAuth({ nonce: 'n2', pollSecretHash: 'right', ttlSeconds: 300 });
    await store.completeDesktopAuth('n2', { userId: 'u', email: null, sessionId: null });
    expect(await store.claimDesktopAuth('n2', 'wrong')).toEqual({ status: 'gone' });
    // the wrong attempt didn't consume it — the real desktop still claims it
    expect((await store.claimDesktopAuth('n2', 'right')).status).toBe('done');
  });

  it('an expired rendezvous cannot be completed or claimed', async () => {
    const store = new MemoryStore();
    await store.startDesktopAuth({ nonce: 'n3', pollSecretHash: 'h', ttlSeconds: -1 }); // already past
    expect((await store.completeDesktopAuth('n3', { userId: 'u', email: null, sessionId: null })).ok).toBe(false);
    expect(await store.claimDesktopAuth('n3', 'h')).toEqual({ status: 'gone' });
  });

  // Fifteen minutes (source release 2026-09, unit U1b): Get Pro signs a person up AND takes them
  // through Stripe before the page completes the handoff, and five minutes was a sign-in's budget.
  describe('the window is fifteen minutes', () => {
    afterEach(() => vi.useRealTimers());

    it('a session polled at ten minutes is still pending, at sixteen it is gone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
      const app = createApp(new MemoryStore());
      const { nonce, pollSecret, expiresIn } = (await (await app.request('/auth/desktop/start', { method: 'POST' })).json()) as { nonce: string; pollSecret: string; expiresIn: number };
      expect(expiresIn).toBe(900);
      const poll = () => app.request('/auth/desktop/poll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce, pollSecret }) });

      vi.setSystemTime(new Date('2026-09-29T12:10:00Z'));
      expect(await (await poll()).json()).toEqual({ status: 'pending' });

      vi.setSystemTime(new Date('2026-09-29T12:16:00Z'));
      expect(await (await poll()).json()).toEqual({ status: 'gone' });
    });
  });

  it('completing an unknown nonce is a no-op', async () => {
    const store = new MemoryStore();
    expect((await store.completeDesktopAuth('nope', { userId: 'u', email: null, sessionId: null })).ok).toBe(false);
  });

  it('POST /auth/desktop/start issues a nonce + pollSecret; /poll reports pending; bad input 400s', async () => {
    const app = createApp(new MemoryStore());

    const startRes = await app.request('/auth/desktop/start', { method: 'POST' });
    expect(startRes.status).toBe(200);
    const { nonce, pollSecret, expiresIn } = (await startRes.json()) as { nonce: string; pollSecret: string; expiresIn: number };
    expect(nonce).toBeTruthy();
    expect(pollSecret).toBeTruthy();
    expect(expiresIn).toBe(DESKTOP_AUTH_TTL_MS / 1000);

    const pollRes = await app.request('/auth/desktop/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce, pollSecret }),
    });
    expect(pollRes.status).toBe(200);
    expect(await pollRes.json()).toEqual({ status: 'pending' });

    const badRes = await app.request('/auth/desktop/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }), // missing pollSecret
    });
    expect(badRes.status).toBe(400);
  });
});
