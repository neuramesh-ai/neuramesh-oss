// nm-relay's two validation endpoints: RELAY_SECRET gating, the hashed-at-rest token
// lookup, and the client verdict that keeps the relay dumb (200 { allowed } always —
// non-200 only for misconfiguration).
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashMachineToken } from './machine-auth.js';
import { relayRoutes, type RelayRouteDeps } from './relay.js';
import type { Store } from './store';

const MID = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
const WS = 'a5f0c2d8-1b3e-4f6a-8c9d-2e4f6a8c9d10';
const SECRET = 'Bearer test-relay-secret';

let prevSecret: string | undefined;
let prevDevRelay: string | undefined;
beforeAll(() => {
  prevSecret = process.env['RELAY_SECRET'];
  prevDevRelay = process.env['NM_ALLOW_DEV_RELAY'];
  process.env['RELAY_SECRET'] = 'test-relay-secret';
  delete process.env['NM_ALLOW_DEV_RELAY'];
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env['RELAY_SECRET'];
  else process.env['RELAY_SECRET'] = prevSecret;
  if (prevDevRelay === undefined) delete process.env['NM_ALLOW_DEV_RELAY'];
  else process.env['NM_ALLOW_DEV_RELAY'] = prevDevRelay;
});

const mkApp = (store: Partial<Store>, deps?: RelayRouteDeps): Hono => {
  const app = new Hono();
  relayRoutes(app, store as Store, deps);
  return app;
};

const post = (app: Hono, path: string, body: unknown, auth?: string) =>
  app.request(`/internal/relay/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

const workspaces = (ids: string[]) =>
  ids.map((id) => ({ id })) as unknown as Awaited<ReturnType<Store['listWorkspaces']>>;

it('fails closed when the local relay bypass is enabled in production', () => {
  const priorNodeEnv = process.env['NODE_ENV'];
  const priorDevRelay = process.env['NM_ALLOW_DEV_RELAY'];
  process.env['NODE_ENV'] = 'production';
  process.env['NM_ALLOW_DEV_RELAY'] = '1';
  try {
    expect(() => mkApp({})).toThrow(/NM_ALLOW_DEV_RELAY cannot be enabled in production/);
  } finally {
    if (priorNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = priorNodeEnv;
    if (priorDevRelay === undefined) delete process.env['NM_ALLOW_DEV_RELAY'];
    else process.env['NM_ALLOW_DEV_RELAY'] = priorDevRelay;
  }
});

describe('POST /internal/relay/validate-machine', () => {
  it('refuses without the relay secret, and never reads the store', async () => {
    const app = mkApp({
      machineByTokenHash: async () => {
        throw new Error('must not be reached');
      },
    });
    expect((await post(app, 'validate-machine', { token: 'nmm_x' })).status).toBe(403);
    expect((await post(app, 'validate-machine', { token: 'nmm_x' }, 'Bearer wrong')).status).toBe(403);
  });

  it('501s a store that does not serve machines, 400s a bodyless call', async () => {
    expect((await post(mkApp({}), 'validate-machine', { token: 'nmm_x' }, SECRET)).status).toBe(501);
    const app = mkApp({ machineByTokenHash: async () => null });
    expect((await post(app, 'validate-machine', {}, SECRET)).status).toBe(400);
  });

  it('401s a non-nmm or unknown token; looks up by sha-256, never the plaintext', async () => {
    const seen: string[] = [];
    const app = mkApp({
      machineByTokenHash: async (hash) => {
        seen.push(hash);
        return null;
      },
    });
    expect((await post(app, 'validate-machine', { token: 'not-a-machine-token' }, SECRET)).status).toBe(401);
    expect(seen).toHaveLength(0); // non-nmm shapes never reach the store
    expect((await post(app, 'validate-machine', { token: 'nmm_unknown' }, SECRET)).status).toBe(401);
    expect(seen).toEqual([hashMachineToken('nmm_unknown')]);
  });

  it('returns the machine identity for a known token', async () => {
    const app = mkApp({
      machineByTokenHash: async (hash) =>
        hash === hashMachineToken('nmm_good')
          ? { id: MID, workspace_id: WS, owner_user_id: 'u1', kind: 'member', owner_clerk_id: 'ck1' }
          : null,
    });
    const res = await post(app, 'validate-machine', { token: 'nmm_good' }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ machineId: MID, workspaceId: WS });
  });
});

describe('POST /internal/relay/validate-client', () => {
  const goodClerk: RelayRouteDeps = { verifyClerk: async () => ({ sub: 'ck1' }) };
  const memberStore: Partial<Store> = {
    userIdForClerkId: async (clerkId) => (clerkId === 'ck1' ? 'u1' : null),
    machineWorkspace: async (id) => (id === MID ? { workspaceId: WS, kind: 'runner', ownerUserId: 'u9' } : null),
    listWorkspaces: async () => workspaces([WS]),
  };

  it('refuses without the relay secret; 501s a store without machines; 400s a bad machine id', async () => {
    expect((await post(mkApp(memberStore, goodClerk), 'validate-client', { clerkToken: 't', machineId: MID })).status).toBe(403);
    expect((await post(mkApp({}, goodClerk), 'validate-client', { clerkToken: 't', machineId: MID }, SECRET)).status).toBe(501);
    expect((await post(mkApp(memberStore, goodClerk), 'validate-client', { clerkToken: 't', machineId: 'nope' }, SECRET)).status).toBe(400);
  });

  it('answers allowed:false for a bad clerk token, an unknown user, or an unknown machine — always 200', async () => {
    const badClerk: RelayRouteDeps = {
      verifyClerk: async () => {
        throw new Error('bad token');
      },
    };
    const cases = [
      post(mkApp(memberStore, badClerk), 'validate-client', { clerkToken: 't', machineId: MID }, SECRET),
      post(mkApp({ ...memberStore, userIdForClerkId: async () => null }, goodClerk), 'validate-client', { clerkToken: 't', machineId: MID }, SECRET),
      post(mkApp({ ...memberStore, machineWorkspace: async () => null }, goodClerk), 'validate-client', { clerkToken: 't', machineId: MID }, SECRET),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ allowed: false });
    }
  });

  it('answers allowed:false when the user is not a member of the machine workspace', async () => {
    const app = mkApp({ ...memberStore, listWorkspaces: async () => workspaces(['another-ws']) }, goodClerk);
    const res = await post(app, 'validate-client', { clerkToken: 't', machineId: MID }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });
  });

  it('answers allowed:true with the resolved user for a member', async () => {
    const res = await post(mkApp(memberStore, goodClerk), 'validate-client', { clerkToken: 't', machineId: MID }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: true, userId: 'u1' });
  });
  // A MEMBER MACHINE IS ITS OWNER'S SHELL (member-machines round): the vendor logins live on it,
  // so membership alone never opens it. The runner stays open to every member.
  it('a member machine attaches for its owner only; the runner for any member', async () => {
    const mine = mkApp({ ...memberStore, machineWorkspace: async () => ({ workspaceId: WS, kind: 'member', ownerUserId: 'u1' }) }, goodClerk);
    expect(await (await post(mine, 'validate-client', { clerkToken: 't', machineId: MID }, SECRET)).json()).toEqual({ allowed: true, userId: 'u1' });
    const theirs = mkApp({ ...memberStore, machineWorkspace: async () => ({ workspaceId: WS, kind: 'member', ownerUserId: 'u2' }) }, goodClerk);
    const res = await post(theirs, 'validate-client', { clerkToken: 't', machineId: MID }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });
  });
  it('accepts the local browser identity only behind the explicit dev relay gate', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const store: Partial<Store> = {
      userIdForClerkId: async () => { throw new Error('dev identity must not hit Clerk mapping'); },
      machineWorkspace: async (id) => (id === MID ? { workspaceId: WS, kind: 'runner', ownerUserId: 'u9' } : null),
      listWorkspaces: async (id) => id === userId ? workspaces([WS]) : [],
    };
    const token = 'nmdev_16a2973f06ca66472bc6f888725d346614584d2635966625784812880c52c157';
    const rejectClerk: RelayRouteDeps = { verifyClerk: async () => { throw new Error('not Clerk'); } };
    const closed = await post(mkApp(store, rejectClerk), 'validate-client', { clerkToken: token, machineId: MID }, SECRET);
    expect(await closed.json()).toEqual({ allowed: false });

    process.env['NM_ALLOW_DEV_RELAY'] = '1';
    process.env['NM_DEV_RELAY_TOKEN'] = token;
    process.env['NM_DEV_RELAY_USER'] = userId;
    try {
      const open = await post(mkApp(store, rejectClerk), 'validate-client', { clerkToken: token, machineId: MID }, SECRET);
      expect(open.status).toBe(200);
      expect(await open.json()).toEqual({ allowed: true, userId });
    } finally {
      delete process.env['NM_ALLOW_DEV_RELAY'];
      delete process.env['NM_DEV_RELAY_TOKEN'];
      delete process.env['NM_DEV_RELAY_USER'];
    }
  });

  it('rejects a guessed dev token even when the local relay gate is open', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    process.env['NM_ALLOW_DEV_RELAY'] = '1';
    process.env['NM_DEV_RELAY_TOKEN'] = 'nmdev_16a2973f06ca66472bc6f888725d346614584d2635966625784812880c52c157';
    process.env['NM_DEV_RELAY_USER'] = userId;
    try {
      const res = await post(mkApp(memberStore, { verifyClerk: async () => { throw new Error('not Clerk'); } }), 'validate-client', {
        clerkToken: `nmdev_${userId}`, machineId: MID,
      }, SECRET);
      expect(await res.json()).toEqual({ allowed: false });
    } finally {
      delete process.env['NM_ALLOW_DEV_RELAY'];
      delete process.env['NM_DEV_RELAY_TOKEN'];
      delete process.env['NM_DEV_RELAY_USER'];
    }
  });
});
