// The Cloud Run machine lane against the REAL schema (0155, fleet-cloudrun*.ts, machine-snapshots.ts):
// the boot credential trades for a new epoch and an epoch-bound token at every boot (a crash restart
// included), a replaced token earns 409 STALE_EPOCH and nothing else, a status report walks
// drain → resize, and a stop drains before it scales to 0 (rule M12).
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createCloudMachine } from '../src/fleet';
import { assertEpoch } from '../src/fleet-cloudrun';
import { cloudRunSweep } from '../src/fleet-cloudrun-sweep';
import type { SnapshotStorage } from '../src/gcs-sign';
import { hashMachineToken, mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
// its OWN workspace: the one-member unique index on the shared fixture workspace would collide
const WS = 'a5a5a5a5-0000-0000-0000-00000000c4a1';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const storage: SnapshotStorage = {
  bucket: 'nm-snapshots-test',
  signer: { email: async () => 'nm-api@test.iam.gserviceaccount.com', signBlob: async () => Buffer.alloc(32, 7) },
  stat: async () => null,
};
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store, { snapshots: { storage } }) : null;
const sql = DB ? postgres(DB) : null;

const ENV = { FLEET_SECRET: 'test-fleet-secret', FLEET_CLOUDRUN: '1', FLEET_CLOUDRUN_DRAIN_PCT: '75' } as const;
const saved: Record<string, string | undefined> = {};
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
const json = (b: unknown) => JSON.stringify(b);

let MACHINE = '';
let CREDENTIAL = '';
let TOKEN = '';
let OLD_TOKEN = '';
const row = async () => (await sql!`select epoch, restarts, size_class, drain_state, drain_reason, drain_lost_at, parked_at, desired_replicas, snapshot_work, mem_pct, used_mib, limit_mib, cpu_pct, token_epoch from machines where id = ${MACHINE}::uuid`)[0]!;
const call = (path: string, token: string, body?: unknown) =>
  app!.request(path, body === undefined ? { headers: { authorization: `Bearer ${token}` } } : { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: json(body) });
const status = (body: unknown, token = TOKEN) => call('/v1/machines/status', token, body);
const boot = (credential = CREDENTIAL) => app!.request('/v1/machines/boot', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{}' });
const feedRow = async () => {
  const feed = (await (await app!.request('/internal/fleet-desired', { headers: fleet })).json()) as { workspaces: { id: string; machines: Record<string, unknown>[] }[] };
  return feed.workspaces.find((w) => w.id === WS)!.machines.find((x) => x['id'] === MACHINE)!;
};

beforeAll(async () => {
  if (!sql) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  await sql`insert into workspaces (id, name, slug, created_by, plan) values (${WS}::uuid, 'Cloud Run Test', 'cloudrun-test', ${george.id}::uuid, 'cloud') on conflict (id) do nothing`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${WS}::uuid, ${george.id}::uuid, 'owner') on conflict do nothing`;
  const { hash } = mintMachineToken();
  MACHINE = (await createCloudMachine(sql, { workspaceId: WS, kind: 'member', ownerUserId: george.id, name: 'cloudrun-member', tokenHash: hash, substrate: 'cloudrun' })).id;
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('cloudrun machines on postgres (0155)', () => {
  it('the schema takes the substrate and refuses an unknown size class; the feed carries class and restarts', async () => {
    await expect(sql!`update machines set size_class = 'XXL' where id = ${MACHINE}::uuid`).rejects.toThrow();
    expect(await feedRow()).toMatchObject({ substrate: 'cloudrun', sizeClass: 'S', restartGen: 0, templateReady: false, replicas: 1 });
  });

  it('the boot credential: fleet secret to mint; each boot is a new epoch with an nmm_ token bound to it', async () => {
    const mint = (headers: Record<string, string>) => app!.request(`/internal/machines/${MACHINE}/boot-credential`, { method: 'POST', headers });
    expect((await mint({})).status).toBe(403);
    const first = await mint(fleet);
    expect(first.status).toBe(201);
    const stale = ((await first.json()) as { credential: string }).credential;
    // a second mint rotates: the credential the pool held before stops working
    CREDENTIAL = ((await (await mint(fleet)).json()) as { credential: string }).credential;
    expect((await boot(stale)).status).toBe(401);
    const res = await boot();
    expect(res.status).toBe(200);
    const grant = (await res.json()) as { epoch: number; token: string; expiresAt: string; sizeClass: string; guardPct: number; machineId: string; workspaceId: string; ownerUserId: string; kind: string; snapshot: unknown };
    expect(grant).toMatchObject({ epoch: 1, sizeClass: 'S', guardPct: 90, machineId: MACHINE, workspaceId: WS, ownerUserId: george.id, kind: 'member', snapshot: null });
    expect(grant.token.startsWith('nmm_')).toBe(true);
    expect(Date.parse(grant.expiresAt)).toBeGreaterThan(Date.now());
    OLD_TOKEN = grant.token;
  });

  it('a crash restart boots again: a new epoch, and the replaced token earns 409 on writes and no other lane', async () => {
    const grant = (await (await boot()).json()) as { epoch: number; token: string };
    expect(grant.epoch).toBe(2);
    TOKEN = grant.token;
    const late = await status({ state: 'running', epoch: 1, memPct: 10 }, OLD_TOKEN);
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code: string }).code).toBe('STALE_EPOCH');
    // the control read still answers it: the newer epoch in it is what machined fences on
    const control = await call('/v1/machines/control', OLD_TOKEN);
    expect(control.status).toBe(200);
    expect(await control.json()).toMatchObject({ epoch: 2, action: 'run' });
    // no general lane (the /v1 gate, sync-token, the relay) takes a replaced token; the new one passes
    expect(await store!.machineByTokenHash(hashMachineToken(OLD_TOKEN))).toBeNull();
    expect((await store!.machineByTokenHash(hashMachineToken(TOKEN)))?.id).toBe(MACHINE);
  });

  it('token renewal: the same token, a later expiry, and 409 for an epoch that is not current', async () => {
    const ok = await call('/v1/machines/token', TOKEN, { epoch: 2 });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { token: string; expiresAt: string };
    expect(body.token).toBe(TOKEN);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect((await call('/v1/machines/token', TOKEN, { epoch: 1 })).status).toBe(409);
    expect((await call('/v1/machines/token', OLD_TOKEN, { epoch: 2 })).status).toBe(409);
  });

  it('status persists what machined sends; at the threshold the control turns to drain', async () => {
    const calm = await status({ state: 'running', epoch: 2, memPct: 40, usedMiB: 1638, limitMiB: 4096, cpuPct: 12.5, throttleRatio: 0 });
    expect(calm.status).toBe(200);
    expect(((await calm.json()) as { control: { action: string } }).control.action).toBe('run');
    const hot = await status({ state: 'running', epoch: 2, memPct: 81.5, usedMiB: 3338, limitMiB: 4096, cpuPct: null, throttleRatio: null });
    expect(await hot.json()).toMatchObject({ move: 'request', control: { action: 'drain', epoch: 2 } });
    const r = await row();
    expect(r['drain_state']).toBe('requested');
    expect(r['drain_reason']).toBe('grow');
    expect(Number(r['mem_pct'])).toBeCloseTo(81.5);
    expect(r['used_mib']).toBe(3338);
    expect(Number(r['cpu_pct'])).toBeCloseTo(12.5);
    expect(await (await call('/v1/machines/control', TOKEN)).json()).toEqual({ epoch: 2, action: 'drain', snapshot: null, wake: false });
  });

  it('drained: keys stored, the class grows, a restart is counted, and the feed lets the template move', async () => {
    const res = await status({ state: 'drained', epoch: 2, memPct: 82, usedMiB: 3360, limitMiB: 4096, cpuPct: null, throttleRatio: null, reason: 'controller', snapshot: { work: 'work-e2', box: 'box-e2' }, drainMs: 900 });
    expect(await res.json()).toMatchObject({ move: 'resize', control: { action: 'run', epoch: 2, snapshot: { work: 'work-e2', box: 'box-e2' } } });
    const r = await row();
    expect(r['size_class']).toBe('M');
    expect(Number(r['restarts'])).toBe(1);
    expect(r['drain_state']).toBe('resizing');
    expect(Number(r['epoch'])).toBe(2);
    expect(await feedRow()).toMatchObject({ sizeClass: 'M', restartGen: 1, templateReady: true });
  });

  it('the new revision boots: epoch 3, the restore keys in the grant, and the drained instance fenced', async () => {
    const grant = (await (await boot()).json()) as { epoch: number; token: string; sizeClass: string; snapshot: unknown };
    expect(grant).toMatchObject({ epoch: 3, sizeClass: 'M', snapshot: { work: 'work-e2', box: 'box-e2' } });
    const drained = TOKEN;
    TOKEN = grant.token;
    expect((await status({ state: 'drained', epoch: 2, snapshot: { work: 'work-x' } }, drained)).status).toBe(409);
    expect((await row())['snapshot_work']).toBe('work-e2');
    const upload = (token: string, body: unknown) => call('/v1/machines/snapshots/sign', token, body);
    expect((await upload(drained, { kind: 'snapshot', key: 'work-x', op: 'upload', epoch: 2 })).status).toBe(409);
    expect((await upload(TOKEN, { kind: 'snapshot', key: 'work-e3', op: 'upload' })).status).toBe(422);
    expect((await upload(TOKEN, { kind: 'snapshot', key: 'work-e3', op: 'upload', epoch: 2 })).status).toBe(409);
    const ok = await upload(TOKEN, { kind: 'snapshot', key: 'work-e3', op: 'upload', epoch: 3 });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { object: string }).object).toBe(`v1/workspaces/${WS}/machines/${MACHINE}/snapshots/work-e3.tar.zst`);
    await expect(assertEpoch(sql!, MACHINE, 2)).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    expect(await (await status({ state: 'running', epoch: 3, memPct: 20 })).json()).toMatchObject({ move: 'settled' });
    expect((await row())['drain_state']).toBeNull();
  });

  it('an idle stop drains first: the sweep asks, the drained report parks, nothing scales to 0 before it', async () => {
    await sql!`update machines set last_wake_at = now() - interval '3 days', last_active_at = now() - interval '3 days' where id = ${MACHINE}::uuid`;
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.idleDrains).toContain(MACHINE);
    expect(await feedRow()).toMatchObject({ replicas: 1 });
    expect(await (await call('/v1/machines/control', TOKEN)).json()).toMatchObject({ action: 'drain', epoch: 3 });
    const parked = await status({ state: 'drained', epoch: 3, reason: 'controller', snapshot: { work: 'work-e3' } });
    expect(await parked.json()).toMatchObject({ move: 'park' });
    const r = await row();
    expect(r['desired_replicas']).toBe(0);
    expect(r['parked_at']).not.toBeNull();
    expect(r['snapshot_work']).toBe('work-e3');
    expect(r['drain_lost_at']).toBeNull();
    // the parked instance is still alive until nm-fleet scales the pool to 0: no wake yet
    expect(await (await call('/v1/machines/control', TOKEN)).json()).toMatchObject({ action: 'run', wake: false });
    // a wake (a message, a prewake) in that window: the drained instance reads wake and restarts
    await sql!`update machines set desired_replicas = 1, started_at = now() where id = ${MACHINE}::uuid`;
    expect(await (await call('/v1/machines/control', TOKEN)).json()).toMatchObject({ action: 'run', epoch: 3, wake: true });
  });

  it('a stop that misses its 3-minute deadline scales to 0 anyway, and the loss is stamped', async () => {
    await sql!`update machines set desired_replicas = 1, drain_state = 'draining', drain_reason = 'idle', drain_deadline = now() - interval '1 second', parked_at = null where id = ${MACHINE}::uuid`;
    expect(await feedRow()).toMatchObject({ replicas: 0 });
    const pass = await cloudRunSweep(sql!, 2880);
    expect(pass.lost).toContain(MACHINE);
    const r = await row();
    expect(r['desired_replicas']).toBe(0);
    expect(r['drain_lost_at']).not.toBeNull();
    expect(r['drain_state']).toBeNull();
  });

  it('a roll drains too: the operator asks, the drained report restarts at the same class', async () => {
    await sql!`update machines set desired_replicas = 1, drain_lost_at = null where id = ${MACHINE}::uuid`;
    const ask = await app!.request(`/internal/machines/${MACHINE}/roll`, { method: 'POST', headers: fleet });
    expect(await ask.json()).toEqual({ requested: true });
    expect(await (await app!.request(`/internal/machines/${MACHINE}/roll`, { method: 'POST', headers: fleet })).json()).toEqual({ requested: false });
    const res = await status({ state: 'drained', epoch: 3, reason: 'controller', snapshot: { work: 'work-r3', box: 'box-r3' } });
    expect(await res.json()).toMatchObject({ move: 'resize' });
    const r = await row();
    expect(r['size_class']).toBe('M');
    expect(r['drain_state']).toBe('resizing');
    expect(Number(r['restarts'])).toBe(2);
    // a resize keeps the drained instance until nm-fleet writes the new template: never a wake
    expect(await (await call('/v1/machines/control', TOKEN)).json()).toMatchObject({ action: 'run', wake: false });
  });

  it('a person is never the caller: the sign route and status refuse a human lane', async () => {
    const headers = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
    expect((await app!.request('/v1/machines/snapshots/sign', { method: 'POST', headers, body: json({ kind: 'snapshot', key: 'k', op: 'exists' }) })).status).toBe(403);
    expect((await app!.request('/v1/machines/status', { method: 'POST', headers, body: json({ epoch: 3, state: 'running' }) })).status).toBe(403);
  });
});
