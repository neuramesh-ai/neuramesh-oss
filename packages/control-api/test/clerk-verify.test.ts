// Clerk token verification (R10 lane A, NM-096 + NM-171), against a real RS256 key pair and a
// stubbed JWKS endpoint. Each case loads a fresh clerk.ts so the module's key cache starts empty.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DOMAIN = 'clerk.r10.test';
const ISS = `https://${DOMAIN}`;
const pair = (kid: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid, alg: 'RS256', use: 'sig' } };
};
const K1 = pair('k1');
const K2 = pair('k2');
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(key: { kid: string; privateKey: KeyObject }, claims: Record<string, unknown>): string {
  const input = `${b64({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key.privateKey).toString('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = (over: Record<string, unknown> = {}) => ({ sub: 'user_1', iss: ISS, exp: now() + 300, iat: now(), sid: 'sess_1', ...over });

let served: unknown[][] = [];
let fetches = 0;
const realFetch = globalThis.fetch;
const saved = { ...process.env };

async function fresh() {
  vi.resetModules();
  return import('../src/clerk');
}
async function verdict(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return (e as { code?: string }).code ?? String(e); }
}

beforeEach(() => {
  process.env['CLERK_PUBLISHABLE_KEY'] = `pk_test_${Buffer.from(`${DOMAIN}$`).toString('base64')}`;
  delete process.env['CLERK_ALLOWED_AUDIENCES'];
  delete process.env['CLERK_AUTHORIZED_PARTIES'];
  fetches = 0;
  globalThis.fetch = (async (url: string | URL) => {
    if (!String(url).endsWith('/.well-known/jwks.json')) throw new Error(`unexpected fetch ${String(url)}`);
    fetches++;
    const keys = served.length > 1 ? served.shift()! : served[0] ?? [];
    return new Response(JSON.stringify({ keys }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...saved }; });

describe('NM-096: an unknown kid refetches the key set once', () => {
  it('a token signed with a freshly rotated key verifies without waiting out the cache', async () => {
    const clerk = await fresh();
    served = [[K1.jwk], [K1.jwk, K2.jwk]];
    expect(await verdict(clerk.verifyClerkToken(token(K1, good())))).toBe('OK');
    expect(await verdict(clerk.verifyClerkToken(token(K2, good())))).toBe('OK');
    expect(fetches).toBe(2);
  });

  it('an empty key set is never cached as good', async () => {
    const clerk = await fresh();
    served = [[], [K1.jwk]];
    expect(await verdict(clerk.verifyClerkToken(token(K1, good())))).toBe('AUTH_UNAVAILABLE');
    expect(await verdict(clerk.verifyClerkToken(token(K1, good())))).toBe('OK');
  });

  it('a kid that is still unknown after a fresh fetch is a 401, and misses do not hammer Clerk', async () => {
    const clerk = await fresh();
    served = [[K1.jwk]];
    const stranger = pair('k-unknown');
    expect(await verdict(clerk.verifyClerkToken(token(K1, good())))).toBe('OK');
    expect(await verdict(clerk.verifyClerkToken(token(stranger, good())))).toBe('AUTH_FAILED');
    expect(await verdict(clerk.verifyClerkToken(token(stranger, good())))).toBe('AUTH_FAILED');
    expect(fetches).toBe(2); // the first read, and ONE forced refetch inside the rate window
  });
});

describe('NM-171: exp and iss are required; aud and azp are pinned when the deploy names them', () => {
  it('a signed token with no expiry is refused', async () => {
    const clerk = await fresh();
    served = [[K1.jwk]];
    const noExp: Record<string, unknown> = good();
    delete noExp['exp'];
    expect(await verdict(clerk.verifyClerkToken(token(K1, noExp)))).toBe('AUTH_FAILED');
  });

  it('a signed token with no issuer is refused', async () => {
    const clerk = await fresh();
    served = [[K1.jwk]];
    const noIss: Record<string, unknown> = good();
    delete noIss['iss'];
    expect(await verdict(clerk.verifyClerkToken(token(K1, noIss)))).toBe('AUTH_FAILED');
  });

  it('a template token for another audience is refused once CLERK_ALLOWED_AUDIENCES is set', async () => {
    const clerk = await fresh();
    served = [[K1.jwk]];
    const powersync = token(K1, good({ aud: 'https://sync.example.test' }));
    expect(await verdict(clerk.verifyClerkToken(powersync))).toBe('OK');
    process.env['CLERK_ALLOWED_AUDIENCES'] = 'nm-api';
    expect(await verdict(clerk.verifyClerkToken(powersync))).toBe('AUTH_FAILED');
    expect(await verdict(clerk.verifyClerkToken(token(K1, good())))).toBe('OK');
  });

  it('an unexpected authorized party is refused once CLERK_AUTHORIZED_PARTIES is set', async () => {
    const clerk = await fresh();
    served = [[K1.jwk]];
    process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://hq.neuramesh.app';
    expect(await verdict(clerk.verifyClerkToken(token(K1, good({ azp: 'https://evil.example' }))))).toBe('AUTH_FAILED');
    expect(await verdict(clerk.verifyClerkToken(token(K1, good({ azp: 'https://hq.neuramesh.app' }))))).toBe('OK');
  });
});
