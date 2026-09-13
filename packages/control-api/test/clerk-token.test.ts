import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// /auth/clerk/token error semantics. The desktop signs the user out (drops the stored
// session + relaunches) on a 401 — so 401 is reserved for a VERIFIED-dead Clerk session
// (SESSION_EXPIRED). Every transient failure (Clerk outage, network, missing config,
// missing JWT template) must be 503 AUTH_UNAVAILABLE: the 2026-07-10 class bug was a
// Clerk blip reading as "logged out".
describe('POST /auth/clerk/token', () => {
  const app = createApp(new MemoryStore());
  const mintUrl = (id: string) => `https://api.clerk.com/v1/sessions/${id}/tokens/powersync`;
  const probeUrl = (id: string) => `https://api.clerk.com/v1/sessions/${id}`;

  const post = (sessionId = 'sess_1') =>
    app.request('/auth/clerk/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

  // stub fetch by URL: the mint POST and the session probe GET get their own responses
  const stubClerk = (opts: { mint: Response | Error; probe?: Response | Error }) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const pick = url === mintUrl('sess_1') ? opts.mint : url === probeUrl('sess_1') ? (opts.probe ?? new Error('unexpected probe')) : new Error(`unexpected fetch ${url}`);
      return pick instanceof Error ? Promise.reject(pick) : Promise.resolve(pick.clone());
    });
    return calls;
  };

  beforeEach(() => vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('mints a token from a live session', async () => {
    stubClerk({ mint: new Response(JSON.stringify({ jwt: 'jwt_ok' }), { status: 200 }) });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'jwt_ok' });
  });

  it('a verified-dead session (mint 4xx + probe 404) is 401 SESSION_EXPIRED — the one sign-out signal', async () => {
    stubClerk({
      mint: new Response(JSON.stringify({ errors: [{ message: 'Session not found' }] }), { status: 404 }),
      probe: new Response('not found', { status: 404 }),
    });
    const res = await post();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('SESSION_EXPIRED');
  });

  it('a revoked session (probe says non-active) is 401 SESSION_EXPIRED', async () => {
    stubClerk({
      mint: new Response(JSON.stringify({ errors: [{ message: 'session inactive' }] }), { status: 400 }),
      probe: new Response(JSON.stringify({ status: 'revoked' }), { status: 200 }),
    });
    const res = await post();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('SESSION_EXPIRED');
  });

  it('a mint 4xx with a LIVE session (missing JWT template / config error) is 503, never a sign-out', async () => {
    stubClerk({
      mint: new Response(JSON.stringify({ errors: [{ message: 'template not found' }] }), { status: 404 }),
      probe: new Response(JSON.stringify({ status: 'active' }), { status: 200 }),
    });
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_UNAVAILABLE');
  });

  it('a Clerk 5xx is 503 without consulting the probe', async () => {
    const calls = stubClerk({ mint: new Response('upstream sad', { status: 502 }) });
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_UNAVAILABLE');
    expect(calls).toEqual([mintUrl('sess_1')]);
  });

  it('a network failure reaching Clerk is 503', async () => {
    stubClerk({ mint: new Error('getaddrinfo ENOTFOUND api.clerk.com') });
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_UNAVAILABLE');
  });

  it('an inconclusive probe (network error) stays 503 — uncertainty never signs the user out', async () => {
    stubClerk({
      mint: new Response(JSON.stringify({ errors: [{ message: 'unauthorized' }] }), { status: 401 }),
      probe: new Error('socket hang up'),
    });
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_UNAVAILABLE');
  });

  it('a missing CLERK_SECRET_KEY is a config failure (503), not an auth verdict', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', '');
    stubClerk({ mint: new Error('must not fetch') });
    const res = await post();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_UNAVAILABLE');
  });

  it('a missing sessionId is still 400', async () => {
    const res = await app.request('/auth/clerk/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
