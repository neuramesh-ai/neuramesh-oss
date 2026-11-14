// The machine feed (local-sync.ts) and the e2e doors (e2e-routes.ts) against the REAL schema. A Cloud
// Run machine's epoch-bound token reads its OWN workspace, never its owner's other workspaces, on both
// paths (/v1/sync/* and /v1/brain/replica/*). The feed needs no flag since round 7 (upstream retired
// PowerSync, so every client reads it). A replaced epoch reads nothing. Long-polls and gzip work on both
// paths. The test doors write exactly the drain rows the production walk writes. Run via the pg lane.
import type { Actor } from '@neuramesh/shared';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { e2eRoutes } from '../src/e2e-routes';
import { createCloudMachine } from '../src/fleet';
import { decodeLocalCursor } from '../src/local-sync';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
if (app && store) e2eRoutes(app, store);
const sql = DB ? postgres(DB) : null;

const ENV = { FLEET_SECRET: 'test-fleet-secret', FLEET_CLOUDRUN: '1', NM_E2E_ROUTES: '1', NM_ALLOW_ACTOR_HEADER: '1' } as const;
const saved: Record<string, string | undefined> = {};
const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
const asGeorge = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
const tag = `feed-${Date.now().toString(36)}`;

let WS = '';
let CHANNEL = '';
let MACHINE = '';
let TOKEN = '';
let wasEnabled = false;

const feedGet = (path: string, token = TOKEN, header: Actor | null = george) =>
  app!.request(path, { headers: { authorization: `Bearer ${token}`, ...(header ? { 'x-nm-actor': JSON.stringify(header) } : {}) } });
const boot = async (credential: string) => (await (await app!.request('/v1/machines/boot', { method: 'POST', headers: { authorization: `Bearer ${credential}` }, body: '{}' })).json()) as { token: string; epoch: number };
const post = (path: string, body: unknown, headers: Record<string, string> = asGeorge) => app!.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

beforeAll(async () => {
  if (!sql) return;
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  wasEnabled = (await sql<{ enabled: boolean }[]>`select enabled from local_sync_state where singleton`)[0]?.enabled ?? false;
  const made = (await (await post('/v1/commands', { type: 'workspace.create', name: `Feed ${tag}`, slug: tag })).json()) as { workspaceId: string; channelId: string };
  WS = made.workspaceId; CHANNEL = made.channelId;
  MACHINE = (await createCloudMachine(sql, { workspaceId: WS, kind: 'runner', ownerUserId: george.id, name: 'runner', tokenHash: mintMachineToken().hash, substrate: 'cloudrun' })).id;
  const { credential } = (await (await app!.request(`/internal/machines/${MACHINE}/boot-credential`, { method: 'POST', headers: fleet })).json()) as { credential: string };
  TOKEN = (await boot(credential)).token;
  (globalThis as { __feedCredential?: string }).__feedCredential = credential;
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  // the feed's switch is one global row: leave it as the suite found it
  if (sql && !wasEnabled) await sql`update local_sync_state set enabled = false where singleton`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the machine feed on postgres', { timeout: 30_000 }, () => {
  it('is open with no flag, to machines and members, on both paths, and never cached', async () => {
    for (const path of ['/v1/sync/bootstrap', '/v1/brain/replica/bootstrap']) {
      const machine = await feedGet(path);
      expect(machine.status).toBe(200);
      expect(machine.headers.get('cache-control')).toBe('private, no-store');
      expect(((await machine.json()) as { workspaces: string[] }).workspaces).toEqual([WS]);
      // a member on the hosted service reads the feed too (the old NM_LOCAL_SYNC gate is gone)
      const human = await app!.request(path, { headers: asGeorge });
      expect(human.status).toBe(200);
      expect(((await human.json()) as { workspaces: string[] }).workspaces).toContain(WS);
    }
  });

  it('serves the machine its own workspace, never the owner\'s others', async () => {
    const res = await feedGet('/v1/sync/bootstrap');
    expect(res.status).toBe(200);
    const boot = (await res.json()) as { workspaces: string[]; changes: { table: string; id: string; row: Record<string, unknown> | null }[]; cursor: string };
    // george is a member of the fixture workspace too; the machine reads only the one it lives in
    expect(boot.workspaces).toEqual([WS]);
    expect(boot.changes.some((c) => c.table === 'machines' && c.id === MACHINE)).toBe(true);
    expect(boot.changes.every((c) => c.row === null || c.row['workspace_id'] === undefined || c.row['workspace_id'] === WS)).toBe(true);
    expect(boot.changes.find((c) => c.table === 'machines' && c.id === MACHINE)?.row).not.toHaveProperty('token_hash');

    // a message in its workspace arrives on the next page; one in another workspace does not
    const sent = (await (await post('/v1/messages', { workspace: WS, channel: CHANNEL, body: `hello ${tag}` })).json()) as { message?: { id: string } };
    expect(sent.message?.id).toBeTruthy();
    const delta = (await (await feedGet(`/v1/sync/changes?cursor=${encodeURIComponent(boot.cursor)}`)).json()) as typeof boot;
    expect(delta.changes.some((c) => c.table === 'messages' && c.id === sent.message!.id)).toBe(true);
    expect(delta.changes.every((c) => c.row === null || c.row['workspace_id'] === undefined || c.row['workspace_id'] === WS)).toBe(true);
    expect(decodeLocalCursor(delta.cursor)).not.toBeNull();
  });

  it('a header naming someone the machine may not be is refused by the gate; no header acts as the owner', async () => {
    expect((await feedGet('/v1/sync/bootstrap', TOKEN, { kind: 'human', id: '00000000-0000-0000-0000-00000000dead' })).status).toBe(401);
    expect((await feedGet('/v1/sync/bootstrap', TOKEN, null)).status).toBe(200);
  });

  it('a replaced epoch reads nothing', async () => {
    const old = TOKEN;
    TOKEN = (await boot((globalThis as { __feedCredential?: string }).__feedCredential!)).token;
    expect((await feedGet('/v1/sync/bootstrap', old)).status).toBe(401);
    expect((await feedGet('/v1/sync/bootstrap')).status).toBe(200);
  });

  // round 5: the bootstrap rides gzip for a client that asks (a small workspace's was 1 MB, most of
  // it skill bodies the replica needs), and a client that does not ask reads the same bytes as before
  it('gzips the snapshot for a client that accepts it, and the snapshot inside is the same', async () => {
    const plain = await feedGet('/v1/sync/bootstrap');
    expect(plain.headers.get('content-encoding')).toBeNull();
    const want = (await plain.json()) as { workspaces: string[]; changes: unknown[] };
    const zipped = await app!.request('/v1/sync/bootstrap', { headers: { authorization: `Bearer ${TOKEN}`, 'accept-encoding': 'gzip, deflate, br' } });
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(zipped.headers.get('vary')).toContain('Accept-Encoding');
    const got = JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString('utf8')) as typeof want;
    expect(got.workspaces).toEqual(want.workspaces);
    expect(got.changes.length).toBe(want.changes.length);
  });

  // round 7: client-core SQLiteReplica reads /v1/brain/replica/*, so the long-poll and gzip live there too
  it('gzips /v1/brain/replica for a client that accepts it', async () => {
    const zipped = await app!.request('/v1/brain/replica/bootstrap', { headers: { authorization: `Bearer ${TOKEN}`, 'accept-encoding': 'gzip' } });
    expect(zipped.status).toBe(200);
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const got = JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString('utf8')) as { workspaces: string[]; wait?: number };
    expect(got.workspaces).toEqual([WS]);
    expect(got.wait).toBeGreaterThan(0);
  });

  it('holds a /v1/brain/replica long-poll until a write in its workspace, and answers an idle one with the same cursor', async () => {
    // the earlier message's wake bump writes the machine row a moment later (fire and forget), which is
    // news for this workspace: retry until an idle wait sees a quiet workspace
    let boot = { cursor: '' };
    let held = false;
    for (let attempt = 0; attempt < 5 && !held; attempt++) {
      boot = (await (await feedGet('/v1/brain/replica/bootstrap')).json()) as { cursor: string };
      const t0 = Date.now();
      const idle = await feedGet(`/v1/brain/replica/changes?cursor=${encodeURIComponent(boot.cursor)}&wait=1`);
      expect(idle.status).toBe(200);
      expect(idle.headers.get('x-nm-sync-wait')).toMatch(/^\d+$/);
      const body = (await idle.json()) as { cursor: string };
      held = Date.now() - t0 >= 700 && body.cursor === boot.cursor;
    }
    expect(held).toBe(true);
    const pending = feedGet(`/v1/brain/replica/changes?cursor=${encodeURIComponent(boot.cursor)}&wait=10`);
    await new Promise((r) => setTimeout(r, 300));
    const sent = (await (await post('/v1/messages', { workspace: WS, channel: CHANNEL, body: `wake ${tag}` })).json()) as { message?: { id: string } };
    const t1 = Date.now();
    const woke = (await (await pending).json()) as { cursor: string; changes: { table: string; id: string }[] };
    expect(Date.now() - t1).toBeLessThan(3_000);
    expect(woke.cursor).not.toBe(boot.cursor);
    // the wait answers on the first news, which may be the wake bump's machine row: the message is in
    // the changes after the same cursor either way
    const since = (await (await feedGet(`/v1/brain/replica/changes?cursor=${encodeURIComponent(boot.cursor)}`)).json()) as typeof woke;
    expect(since.changes.some((c) => c.table === 'messages' && c.id === sent.message?.id)).toBe(true);
  });
});

describe.skipIf(!DB)('the e2e doors (NM_E2E_ROUTES)', () => {
  const row = async () => (await sql!`select drain_state, drain_reason, drain_deadline from machines where id = ${MACHINE}::uuid`)[0]!;

  it('need the flag and the fleet secret', async () => {
    expect((await post('/internal/e2e/users', { email: `${tag}@e2e.invalid` }, { 'content-type': 'application/json' })).status).toBe(403);
    process.env['NM_E2E_ROUTES'] = '0';
    expect((await post('/internal/e2e/users', { email: `${tag}@e2e.invalid` }, fleet)).status).toBe(403);
    process.env['NM_E2E_ROUTES'] = '1';
    const made = await post('/internal/e2e/users', { email: `${tag}@e2e.invalid` }, fleet);
    expect(made.status).toBe(201);
    const again = (await (await post('/internal/e2e/users', { email: `${tag}@e2e.invalid` }, fleet)).json()) as { userId: string; created: boolean };
    expect(again.created).toBe(false);
  });

  it('resize asks for the walk\'s grow drain and refuses a class the walk would not pick', async () => {
    expect((await post(`/internal/e2e/workspaces/${WS}/fund`, { plan: 'cloud', credits: 100 }, fleet)).status).toBe(200);
    const wrong = await post(`/internal/machines/${MACHINE}/resize`, { sizeClass: 'XL' }, fleet);
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { next: string }).next).toBe('M');
    const ok = await post(`/internal/machines/${MACHINE}/resize`, { sizeClass: 'M' }, fleet);
    expect(ok.status).toBe(200);
    expect(await row()).toMatchObject({ drain_state: 'requested', drain_reason: 'grow' });
    expect((await post(`/internal/machines/${MACHINE}/resize`, {}, fleet)).status).toBe(409);
    const control = (await (await feedGet('/v1/machines/control')).json()) as { action: string };
    expect(control.action).toBe('drain');
  });

  it('idle-drain writes the sweep\'s stop drain', async () => {
    await sql!`update machines set drain_state = null, drain_reason = null where id = ${MACHINE}::uuid`;
    expect((await post(`/internal/machines/${MACHINE}/idle-drain`, {}, fleet)).status).toBe(200);
    const r = await row();
    expect(r).toMatchObject({ drain_state: 'draining', drain_reason: 'idle' });
    expect(r['drain_deadline']).not.toBeNull();
    const seen = (await (await app!.request(`/internal/e2e/machines/${MACHINE}`, { headers: fleet })).json()) as Record<string, unknown>;
    expect(seen).toMatchObject({ id: MACHINE, substrate: 'cloudrun', drain_reason: 'idle', plan: 'cloud', has_boot_credential: true });
  });
});
