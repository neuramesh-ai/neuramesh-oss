// The second wall for sign-in (docs/design/message-boards-2026-11/plan.md §7.5). Message boards is its
// own origin on the same Clerk instance, so a session token that its page got is signed by the same keys
// as hq's. nm-api refuses it by its authorized party (`azp`), so a hostile message board page cannot use
// a person's session on the core API. Against a real RS256 key pair and a stubbed JWKS endpoint, the
// clerk-verify.test.ts way: each case loads a fresh clerk.ts so the module's key cache starts empty.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DOMAIN = 'clerk.boards-wall.test';
const ISS = `https://${DOMAIN}`;
const BOARDS = 'https://boards.neuramesh.app';
const HQ = 'https://hq.neuramesh.app';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { kid: 'k1', privateKey, jwk: { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1', alg: 'RS256', use: 'sig' } };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(key: { kid: string; privateKey: KeyObject }, claims: Record<string, unknown>): string {
  const input = `${b64({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key.privateKey).toString('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const session = (azp?: string) => token(KEY, { sub: 'user_1', iss: ISS, exp: now() + 300, iat: now(), sid: 'sess_1', ...(azp ? { azp } : {}) });

const realFetch = globalThis.fetch;
const saved = { ...process.env };

async function fresh() {
  vi.resetModules();
  return import('../src/clerk');
}
async function verdict(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return `${(e as { code?: string }).code}: ${(e as Error).message}`; }
}

beforeEach(() => {
  process.env['CLERK_PUBLISHABLE_KEY'] = `pk_test_${Buffer.from(`${DOMAIN}$`).toString('base64')}`;
  delete process.env['CLERK_ALLOWED_AUDIENCES'];
  delete process.env['CLERK_AUTHORIZED_PARTIES'];
  delete process.env['NM_BOARDS_URL'];
  globalThis.fetch = (async (url: string | URL) => {
    if (!String(url).endsWith('/.well-known/jwks.json')) throw new Error(`unexpected fetch ${String(url)}`);
    return new Response(JSON.stringify({ keys: [KEY.jwk] }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...saved }; });

describe('a session token of the Message boards origin', () => {
  it('is refused once NM_BOARDS_URL names that origin, and a token of any other origin still verifies', async () => {
    const clerk = await fresh();
    process.env['NM_BOARDS_URL'] = `${BOARDS}/`;
    expect(await verdict(clerk.verifyClerkToken(session(BOARDS)))).toBe('AUTH_FAILED: a Message boards session does not work on the NeuraMesh API');
    expect(await verdict(clerk.verifyClerkToken(session(HQ)))).toBe('OK');
    // a native client's token names no party: the desktop and the phone stay signed in
    expect(await verdict(clerk.verifyClerkToken(session()))).toBe('OK');
  });

  it('changes nothing while the setting is unset', async () => {
    const clerk = await fresh();
    expect(await verdict(clerk.verifyClerkToken(session(BOARDS)))).toBe('OK');
  });

  it('is refused even when the party pin lists the boards origin by mistake', async () => {
    const clerk = await fresh();
    process.env['NM_BOARDS_URL'] = BOARDS;
    process.env['CLERK_AUTHORIZED_PARTIES'] = `${HQ},${BOARDS}`;
    expect(await verdict(clerk.verifyClerkToken(session(BOARDS)))).toMatch(/^AUTH_FAILED: a Message boards session/);
    expect(await verdict(clerk.verifyClerkToken(session(HQ)))).toBe('OK');
  });

  it('compares origins, so a path or a slash on the setting does not open the wall', async () => {
    const clerk = await fresh();
    process.env['NM_BOARDS_URL'] = `${BOARDS}/app/`;
    expect(await verdict(clerk.verifyClerkToken(session(BOARDS)))).toMatch(/^AUTH_FAILED/);
    // a look-alike origin is not the boards origin: the allow list above is the wall for strangers
    expect(await verdict(clerk.verifyClerkToken(session('https://boards.neuramesh.app.evil.example')))).toBe('OK');
  });

  it('gets 401 on the /v1 gate and on the sign-in bridge, where an hq token passes the verifier', async () => {
    vi.resetModules();
    process.env['NM_BOARDS_URL'] = BOARDS;
    const { createApp } = await import('../src/app');
    const { MemoryStore } = await import('../src/store');
    const app = createApp(new MemoryStore());
    const me = (bearer: string) => app.request('/v1/me', { headers: { authorization: `Bearer ${bearer}` } });

    const boards = await me(session(BOARDS));
    expect(boards.status).toBe(401);
    expect(await boards.json()).toEqual({ error: 'a Message boards session does not work on the NeuraMesh API', code: 'AUTH_FAILED' });
    // the hq token passes the verifier and stops one step later, at the account lookup of an empty store
    const hq = await me(session(HQ));
    expect(await hq.json()).toEqual({ error: 'no NeuraMesh account for this identity', code: 'AUTH_FAILED' });

    const bridge = await app.request('/auth/clerk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: session(BOARDS) }) });
    expect(bridge.status).toBe(401);
    expect(((await bridge.json()) as { code: string }).code).toBe('AUTH_FAILED');
    const handoff = await app.request('/auth/desktop/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce: 'n', token: session(BOARDS) }) });
    expect(handoff.status).toBe(401);
  });
});
