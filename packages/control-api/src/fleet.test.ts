import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fleetRoutes, rowsToDesired, type CloudMachineRow } from './fleet.js';
import { hashMachineToken } from './machine-auth.js';
import type { Store } from './store';

const row = (over: Partial<CloudMachineRow>): CloudMachineRow => ({
  id: 'm1',
  workspace_id: 'ws1',
  workspace_plan: 'cloud',
  kind: 'member',
  owner_user_id: 'u1',
  desired_replicas: 1,
  lifecycle: 'running',
  resources: {},
  ...over,
});

describe('rowsToDesired', () => {
  it('groups machines under their workspace with plan quotas', () => {
    const out = rowsToDesired([
      row({ id: 'a' }),
      row({ id: 'r', kind: 'runner', owner_user_id: null }),
      row({ id: 'b', workspace_id: 'ws2', workspace_plan: 'free' }),
    ]);
    expect(out.workspaces).toHaveLength(2);
    const ws1 = out.workspaces.find((w) => w.id === 'ws1')!;
    expect(ws1.quotaCpu).toBe('16');
    expect(ws1.machines.map((m) => m.id)).toEqual(['a', 'r']);
    const ws2 = out.workspaces.find((w) => w.id === 'ws2')!;
    expect(ws2.quotaCpu).toBe('4');
  });

  it('the PVC ceiling follows the rows: machines + 1, never below the plan default (member machines)', () => {
    // free allows 2 PVCs by plan; a runner + three member machines needs 5, or the fourth member's
    // pod fails on a quota nobody can see from the app
    const crowded = rowsToDesired([
      row({ id: 'r', kind: 'runner', workspace_plan: 'free' }),
      row({ id: 'a', workspace_plan: 'free' }), row({ id: 'b', owner_user_id: 'u2', workspace_plan: 'free' }), row({ id: 'c', owner_user_id: 'u3', workspace_plan: 'free' }),
    ]);
    expect(crowded.workspaces[0]!.quotaPvcCount).toBe('5');
    // a lone runner keeps the plan's headroom — the ceiling never drops below it
    expect(rowsToDesired([row({ id: 'r', kind: 'runner', workspace_plan: 'free' })]).workspaces[0]!.quotaPvcCount).toBe('2');
    // tombstones do not count: they are not in the namespace any more
    const gone = rowsToDesired([row({ id: 'r', kind: 'runner', workspace_plan: 'cloud' }), row({ id: 'x', lifecycle: 'destroyed', workspace_plan: 'cloud' })]);
    expect(gone.workspaces[0]!.quotaPvcCount).toBe('12');
  });

  it('every machine carries its owner (the sync principal) when the row has one', () => {
    const out = rowsToDesired([row({ id: 'a' }), row({ id: 'r', kind: 'runner', owner_user_id: 'u1' }), row({ id: 'x', kind: 'runner', owner_user_id: null })]);
    const [a, r, x] = out.workspaces[0]!.machines;
    expect(a!.ownerUserId).toBe('u1');
    expect(r!.ownerUserId).toBe('u1');
    expect(x!.ownerUserId).toBeUndefined();
  });

  it('resources jsonb overrides defaults, junk falls back', () => {
    const out = rowsToDesired([row({ resources: { cpu: '1', disk: '', memoryLimit: 42 as unknown as string } })]);
    const m = out.workspaces[0]!.machines[0]!;
    expect(m.cpu).toBe('1');
    expect(m.disk).toBe('50Gi');
    expect(m.memoryLimit).toBe('8Gi');
  });

  it('replicas fail closed (anything but 1 = stopped); destroyed and unknown kinds are dropped', () => {
    const out = rowsToDesired([
      row({ desired_replicas: 7 }),
      row({ id: 'x', lifecycle: 'destroyed' }),
      row({ id: 'y', kind: 'local' }),
    ]);
    expect(out.workspaces[0]!.machines.map((m) => m.id)).toEqual(['m1']);
    expect(out.workspaces[0]!.machines[0]!.replicas).toBe(0);
  });

  it('unknown plan falls back to free quotas', () => {
    const out = rowsToDesired([row({ workspace_plan: 'weird' })]);
    expect(out.workspaces[0]!.quotaCpu).toBe('4');
  });

  // a PVC bills while the pod sits at zero, so the free tier's starting disk is the cost lever
  it('disk defaults per plan: free small, cloud full', () => {
    const out = rowsToDesired([row({ workspace_id: 'wsf', workspace_plan: 'free' }), row({ workspace_id: 'wsc', workspace_plan: 'cloud' })]);
    expect(out.workspaces.find((w) => w.id === 'wsf')!.machines[0]!.disk).toBe('10Gi');
    expect(out.workspaces.find((w) => w.id === 'wsc')!.machines[0]!.disk).toBe('50Gi');
  });

  it('unknown plan gets the small disk — an unrecognised tier never provisions the expensive one', () => {
    const out = rowsToDesired([row({ workspace_plan: 'weird' })]);
    expect(out.workspaces[0]!.machines[0]!.disk).toBe('10Gi');
  });

  it('a row-level resources.disk overrides its plan default, both directions', () => {
    const out = rowsToDesired([
      row({ id: 'big', workspace_id: 'wsf', workspace_plan: 'free', resources: { disk: '200Gi' } }),
      row({ id: 'small', workspace_id: 'wsc', workspace_plan: 'cloud', resources: { disk: '20Gi' } }),
    ]);
    expect(out.workspaces.find((w) => w.id === 'wsf')!.machines[0]!.disk).toBe('200Gi');
    expect(out.workspaces.find((w) => w.id === 'wsc')!.machines[0]!.disk).toBe('20Gi');
  });

  it('only disk varies by plan — cpu/memory/limits are the same on every tier', () => {
    const [free] = rowsToDesired([row({ workspace_plan: 'free' })]).workspaces[0]!.machines;
    const [cloud] = rowsToDesired([row({ workspace_plan: 'cloud' })]).workspaces[0]!.machines;
    expect({ ...free, disk: '' }).toEqual({ ...cloud, disk: '' });
  });
});

// the operator's token-custody mint: fleet-secret in, fresh plaintext out exactly once,
// only the hash reaching the store.
describe('POST /internal/machines/:id/token', () => {
  const MID = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
  let prevSecret: string | undefined;
  beforeAll(() => {
    prevSecret = process.env['FLEET_SECRET'];
    process.env['FLEET_SECRET'] = 'test-fleet-secret';
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env['FLEET_SECRET'];
    else process.env['FLEET_SECRET'] = prevSecret;
  });

  const mkApp = (store: Partial<Store>): Hono => {
    const app = new Hono();
    fleetRoutes(app, store as Store);
    return app;
  };
  const post = (app: Hono, id: string, auth?: string) =>
    app.request(`/internal/machines/${id}/token`, {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
    });

  it('mints, stores only the hash, and returns the plaintext', async () => {
    const seen: { id: string; hash: string }[] = [];
    const app = mkApp({
      rotateMachineToken: async (id, hash) => {
        seen.push({ id, hash });
        return { id };
      },
    });
    const res = await post(app, MID, 'Bearer test-fleet-secret');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    expect(body.token.startsWith('nmm_')).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(MID);
    expect(seen[0]!.hash).toBe(hashMachineToken(body.token));
  });

  it('refuses without the fleet secret, and never mints', async () => {
    const app = mkApp({
      rotateMachineToken: async () => {
        throw new Error('must not be reached');
      },
    });
    expect((await post(app, MID)).status).toBe(403);
    expect((await post(app, MID, 'Bearer wrong')).status).toBe(403);
  });

  it('404s an unknown machine and 400s a non-uuid id', async () => {
    const app = mkApp({ rotateMachineToken: async () => null });
    expect((await post(app, MID, 'Bearer test-fleet-secret')).status).toBe(404);
    expect((await post(app, 'not-a-uuid', 'Bearer test-fleet-secret')).status).toBe(400);
  });
});
