// R10 NM-080: a Clerk session id re-mints tokens on the public door; it is budgeted per session and
// per address now, and the password/sign-up doors per address and per email. 429, never 401: the
// clients retry a 429, and only a 401 signs them out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { AUTH_LIMITS, allowHit, resetAuthThrottle } from '../src/auth-throttle';
import { MemoryStore } from '../src/store';

beforeEach(() => { resetAuthThrottle(); vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_x'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('the session mint is budgeted', () => {
  it('one session id past its budget gets 429; another session from elsewhere still mints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jwt: 'minted' }), { status: 200 })));
    const app = createApp(new MemoryStore());
    const mint = (sessionId: string, ip: string) => app.request('/auth/clerk/api-token', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ sessionId }) });
    for (let i = 0; i < AUTH_LIMITS.sessionMint.max; i++) expect((await mint('sess_leaked', `198.51.100.${i % 50}`)).status).toBe(200);
    const over = await mint('sess_leaked', '203.0.113.9');
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await mint('sess_other', '203.0.113.10')).status).toBe(200);
  });
  it('the password door stops guessing for one email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const app = createApp(new MemoryStore());
    const guess = (ip: string) => app.request('/auth/clerk/password', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email: 'victim@acme.dev', password: 'guess' }) });
    for (let i = 0; i < AUTH_LIMITS.emailPassword.max; i++) expect((await guess(`198.51.100.${i}`)).status).not.toBe(429);
    expect((await guess('203.0.113.77')).status).toBe(429);
  });
  it('an address has no budget on the mint: a stranger cannot spend it and sign a person out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jwt: 'minted' }), { status: 200 })));
    const app = createApp(new MemoryStore());
    const mint = (sessionId: string) => app.request('/auth/clerk/api-token', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5' }, body: JSON.stringify({ sessionId }) });
    // 400 mints with guessed session ids, all with the victim's address in the header the caller writes
    for (let i = 0; i < 400; i++) expect((await mint(`sess_guess_${i}`)).status).toBe(200);
    expect((await mint('sess_victim')).status).toBe(200);
  });
  it('a long key is stored as a digest, and it still has its budget', () => {
    const limit = { max: 2, windowMs: 1000 };
    const long = 'x'.repeat(200_000);
    expect(allowHit(long, limit, 0)).toBe(true);
    expect(allowHit(long, limit, 1)).toBe(true);
    expect(allowHit(long, limit, 2)).toBe(false);
    expect(allowHit(long + 'y', limit, 3)).toBe(true);
  });
  it('a window slides: hits older than it no longer count', () => {
    const limit = { max: 2, windowMs: 1000 };
    expect(allowHit('k', limit, 0)).toBe(true);
    expect(allowHit('k', limit, 10)).toBe(true);
    expect(allowHit('k', limit, 20)).toBe(false);
    expect(allowHit('k', limit, 1500)).toBe(true);
  });
});
