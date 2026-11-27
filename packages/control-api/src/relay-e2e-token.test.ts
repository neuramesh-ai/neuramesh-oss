// The sandbox hq relay token on /internal/relay/validate-client (relay.ts). The hq gateway mints it,
// so the signer below is the gateway's own (infra/images/hq/gateway.mjs signSyncToken, line for line,
// with the relay kid and aud): a token this test signs is a token the gateway would hand a browser.
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relayRoutes, verifyE2eRelayToken, type RelayRouteDeps } from './relay.js';
import type { Store } from './store';

const MID = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
const WS = 'a5f0c2d8-1b3e-4f6a-8c9d-2e4f6a8c9d10';
const U1 = '660b9bc6-9304-4ed2-94dc-149778570d07';
const U2 = 'df526f00-070e-4cff-a574-08c35aaad814';
const SECRET = 'Bearer test-relay-secret';

// the gateway's codec, verbatim
const b64urlToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const bufToB64url = (b: Buffer): string => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jsonB64url = (v: unknown): string => bufToB64url(Buffer.from(JSON.stringify(v)));

// a key whose base64url text holds both '-' and '_', so a pass proves the API decodes it as the gateway does
const KEY = bufToB64url(Buffer.alloc(32, 0xfb));
const OTHER_KEY = bufToB64url(Buffer.alloc(32, 0x5a));
const nowS = (): number => Math.floor(Date.now() / 1000);

interface Mint { sub?: unknown; key?: string; kid?: string; aud?: string; alg?: string; typ?: string; iat?: number; exp?: number }
/** signSyncToken({sub, kid, aud, key, now, ttl}) from the gateway, with each field overridable */
function mint(o: Mint = {}): string {
  const now = nowS();
  const header = { alg: o.alg ?? 'HS256', typ: o.typ ?? 'JWT', kid: o.kid ?? 'nm-hq-relay' };
  const payload = { sub: o.sub ?? U1, aud: o.aud ?? 'nm-relay', iat: o.iat ?? now, exp: o.exp ?? now + 3600 };
  const input = `${jsonB64url(header)}.${jsonB64url(payload)}`;
  return `${input}.${bufToB64url(createHmac('sha256', b64urlToBuf(o.key ?? KEY)).update(input).digest())}`;
}

const ENV_KEYS = ['NM_E2E_ROUTES', 'NM_E2E_RELAY_TOKEN_KEY', 'RELAY_SECRET', 'NODE_ENV', 'NM_ALLOW_DEV_RELAY'] as const;
let saved: Record<string, string | undefined> = {};
// every console line the code under test writes, mount warnings included (the no-log test reads it)
let lines: string[] = [];
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env['RELAY_SECRET'] = 'test-relay-secret';
  process.env['NM_E2E_ROUTES'] = '1';
  process.env['NM_E2E_RELAY_TOKEN_KEY'] = KEY;
  delete process.env['NM_ALLOW_DEV_RELAY'];
  lines = [];
  const capture = (...args: unknown[]): void => { lines.push(args.map(String).join(' ')); };
  for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(capture);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const workspaces = (ids: string[]) => ids.map((id) => ({ id })) as unknown as Awaited<ReturnType<Store['listWorkspaces']>>;
// Clerk must never be asked about a sandbox token it could not know
const noClerk: RelayRouteDeps = { verifyClerk: async () => { throw new Error('not a Clerk token'); } };
const runnerStore: Partial<Store> = {
  userIdForClerkId: async () => { throw new Error('the sandbox lane must not map a Clerk id'); },
  machineWorkspace: async (id) => (id === MID ? { workspaceId: WS, kind: 'runner', ownerUserId: U2 } : null),
  listWorkspaces: async (id) => (id === U1 || id === U2 ? workspaces([WS]) : []),
};

const mkApp = (store: Partial<Store> = runnerStore, deps: RelayRouteDeps = noClerk): Hono => {
  const app = new Hono();
  relayRoutes(app, store as Store, deps);
  return app;
};
const attach = async (app: Hono, token: string, machineId = MID): Promise<{ status: number; body: unknown }> => {
  const res = await app.request('/internal/relay/validate-client', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: SECRET },
    body: JSON.stringify({ clerkToken: token, machineId }),
  });
  return { status: res.status, body: await res.json() };
};
const REFUSED = { status: 200, body: { allowed: false } };

describe('validate-client with the sandbox hq relay token', () => {
  it('accepts a token the gateway would mint, as the nm user it names', async () => {
    expect(KEY).toMatch(/-/);
    expect(KEY).toMatch(/_/);
    expect(await attach(mkApp(), mint())).toEqual({ status: 200, body: { allowed: true, userId: U1 } });
  });

  it('opens a member machine for its owner, and refuses another user\'s member machine', async () => {
    const mine = mkApp({ ...runnerStore, machineWorkspace: async () => ({ workspaceId: WS, kind: 'member', ownerUserId: U1 }) });
    expect(await attach(mine, mint())).toEqual({ status: 200, body: { allowed: true, userId: U1 } });
    const theirs = mkApp({ ...runnerStore, machineWorkspace: async () => ({ workspaceId: WS, kind: 'member', ownerUserId: U2 }) });
    expect(await attach(theirs, mint())).toEqual(REFUSED);
  });

  it('refuses a person who is not a member of the machine\'s workspace, and an unknown machine', async () => {
    const outsider = mkApp({ ...runnerStore, listWorkspaces: async () => workspaces(['another-ws']) });
    expect(await attach(outsider, mint())).toEqual(REFUSED);
    expect(await attach(mkApp(), mint(), 'b2c4f3e1-0d9a-4c8b-9e7f-6a5b4c3d2e1f')).toEqual(REFUSED);
  });

  it('refuses a wrong key, a wrong aud, kid, typ or alg, and a tampered payload', async () => {
    const app = mkApp();
    const good = mint();
    const forged = `${good.split('.')[0]}.${jsonB64url({ sub: U2, aud: 'nm-relay', iat: nowS(), exp: nowS() + 3600 })}.${good.split('.')[2]}`;
    for (const token of [
      mint({ key: OTHER_KEY }), mint({ aud: 'powersync-hq' }), mint({ kid: 'nm-hq' }), mint({ typ: 'at+jwt' }), mint({ alg: 'HS512' }),
      `${jsonB64url({ alg: 'none', typ: 'JWT', kid: 'nm-hq-relay' })}.${good.split('.')[1]}.`, forged, `${good}.extra`, good.slice(0, -2),
    ]) {
      expect(await attach(app, token)).toEqual(REFUSED);
    }
  });

  it('refuses an expired token, one from the future, one living over a day, and a sub that is not a uuid', async () => {
    const app = mkApp();
    const now = nowS();
    for (const token of [
      mint({ iat: now - 7200, exp: now - 3600 }), mint({ iat: now + 600, exp: now + 1200 }),
      mint({ iat: now, exp: now + 86_401 }), mint({ sub: 'e2e|someone@example.com' }), mint({ sub: 42 }),
    ]) {
      expect(await attach(app, token)).toEqual(REFUSED);
    }
  });

  it('is shut unless the e2e doors are open and a key of 32 bytes or more is set', async () => {
    delete process.env['NM_E2E_ROUTES'];
    expect(await attach(mkApp(), mint())).toEqual(REFUSED);
    process.env['NM_E2E_ROUTES'] = '1';
    delete process.env['NM_E2E_RELAY_TOKEN_KEY'];
    expect(await attach(mkApp(), mint())).toEqual(REFUSED);
    const short = bufToB64url(Buffer.alloc(31, 0xfb));
    process.env['NM_E2E_RELAY_TOKEN_KEY'] = short;
    expect(await attach(mkApp(), mint({ key: short }))).toEqual(REFUSED);
  });

  it('never logs the token or the key, accepted or refused', async () => {
    const app = mkApp();
    const tokens = [mint(), mint({ key: OTHER_KEY }), mint({ iat: nowS() - 7200, exp: nowS() - 3600 })];
    for (const token of tokens) await attach(app, token);
    expect(lines.length).toBeGreaterThan(0); // the mount warning, so the capture is live
    const secrets = [KEY, ...tokens.map((t) => t.split('.')[2]!)];
    for (const line of lines) {
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });
});

describe('the sandbox key at mount', () => {
  it('fails closed in production without the e2e doors', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['NM_E2E_ROUTES'];
    expect(() => mkApp()).toThrow(/NM_E2E_RELAY_TOKEN_KEY is set without NM_E2E_ROUTES=1/);
    process.env['NM_E2E_ROUTES'] = '0';
    expect(() => mkApp()).toThrow(/NM_E2E_RELAY_TOKEN_KEY/);
  });

  it('mounts in production beside the e2e doors (the Cloud Run image runs as production), and serves the token', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['NM_E2E_ROUTES'] = '1';
    const app = mkApp();
    expect(await attach(app, mint())).toEqual({ status: 200, body: { allowed: true, userId: U1 } });
  });

  it('mounts in production with no key at all', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['NM_E2E_ROUTES'];
    delete process.env['NM_E2E_RELAY_TOKEN_KEY'];
    expect(() => mkApp()).not.toThrow();
  });
});

describe('verifyE2eRelayToken (the clock pinned)', () => {
  const key = b64urlToBuf(KEY);
  const now = 1_800_000_000;

  it('holds the 60 s skew on exp and iat, and a lifetime of a day at most', () => {
    expect(verifyE2eRelayToken(mint({ iat: now - 3600, exp: now - 59 }), key, now)).toBe(U1);
    expect(verifyE2eRelayToken(mint({ iat: now - 3600, exp: now - 60 }), key, now)).toBeNull();
    expect(verifyE2eRelayToken(mint({ iat: now + 60, exp: now + 3600 }), key, now)).toBe(U1);
    expect(verifyE2eRelayToken(mint({ iat: now + 61, exp: now + 3600 }), key, now)).toBeNull();
    expect(verifyE2eRelayToken(mint({ iat: now, exp: now + 86_400 }), key, now)).toBe(U1);
    expect(verifyE2eRelayToken(mint({ iat: now, exp: now + 86_401 }), key, now)).toBeNull();
  });

  it('refuses a key under 32 bytes even when the token is signed with it', () => {
    const short = bufToB64url(Buffer.alloc(31, 0xfb));
    expect(verifyE2eRelayToken(mint({ key: short, iat: now, exp: now + 60 }), b64urlToBuf(short), now)).toBeNull();
  });
});
