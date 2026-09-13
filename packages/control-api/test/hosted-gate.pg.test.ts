// The hosted write gate against the REAL schema (source release 2026-09, unit U1b). With the
// flag on, a `free` hosted workspace: refuses task.create with 402 PLAN_LIMIT, answers the
// upload lanes with 409 PLAN_LIMIT, still registers and heartbeats a machine, still reads, and
// still exports. The id-to-workspace resolver is exercised through a taskId command and a
// whiteboard PATCH. A `cloud` workspace is untouched. With the flag off, and under NM_LOCAL=1,
// nothing changes. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { GATE_REFUSAL } from '../src/hosted-gate';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });

async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
async function makeWorkspace(owner: Actor, plan: 'free' | 'cloud'): Promise<{ id: string; general: string; taskId: string; whiteboardId: string }> {
  const made = await j(await send(owner, { type: 'workspace.create', name: `Gate ${plan}`, slug: `u1b-gate-${plan}-${Date.now().toString(36)}` }));
  const id = made.workspaceId as string;
  // seeded on cloud so the fixture rows land, then set out loud (the dev seed makes cloud)
  const task = await j(await send(owner, { type: 'task.create', workspace: id, channel: 'general', title: `a ${plan} task` }));
  const wb = await j(await app!.request('/v1/whiteboards', {
    method: 'POST', headers: hdr(owner),
    body: JSON.stringify({ id: crypto.randomUUID(), workspace: id, channel: made.channelId, title: 'gate board', rev: 1 }),
  }));
  await sql!`update workspaces set plan = ${plan} where id = ${id}::uuid`;
  return { id, general: made.channelId as string, taskId: task.task.id as string, whiteboardId: wb.whiteboard.id as string };
}

const env = { flag: process.env['NM_HOSTED_FREE_GATE'], local: process.env['NM_LOCAL'] };
let owner: Actor; let free: Awaited<ReturnType<typeof makeWorkspace>>; let cloud: Awaited<ReturnType<typeof makeWorkspace>>;

beforeAll(async () => {
  if (!sql) return;
  owner = await makeUser('clerk_u1b_gate_owner', 'owner@gate.test');
  free = await makeWorkspace(owner, 'free');
  cloud = await makeWorkspace(owner, 'cloud');
});
beforeEach(() => { process.env['NM_HOSTED_FREE_GATE'] = '1'; delete process.env['NM_LOCAL']; });
afterEach(() => {
  if (env.flag === undefined) delete process.env['NM_HOSTED_FREE_GATE']; else process.env['NM_HOSTED_FREE_GATE'] = env.flag;
  if (env.local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = env.local;
});
afterAll(async () => { await sql?.end(); await store?.close(); });

const message = (ws: { id: string; general: string }) => app!.request('/v1/messages', {
  method: 'POST', headers: hdr(owner), body: JSON.stringify({ workspace: ws.id, channel: ws.general, body: 'typed into a gated room' }),
});
const board = (ws: { id: string; general: string }) => app!.request('/v1/whiteboards', {
  method: 'POST', headers: hdr(owner), body: JSON.stringify({ id: crypto.randomUUID(), workspace: ws.id, channel: ws.general, title: 'new board', rev: 1 }),
});

describe.skipIf(!DB)('the hosted write gate on postgres (flag on)', () => {
  it('a free workspace: task.create is 402 PLAN_LIMIT with the refusal sentence', async () => {
    const res = await send(owner, { type: 'task.create', workspace: free.id, channel: 'general', title: 'refused' });
    expect(res.status).toBe(402);
    expect(await j(res)).toEqual({ error: GATE_REFUSAL, code: 'PLAN_LIMIT' });
  });

  it('a command that names only a taskId resolves its workspace through the row (the resolver)', async () => {
    const res = await send(owner, { type: 'task.update_details', taskId: free.taskId, title: 'renamed under the gate' });
    expect(res.status).toBe(402);
    expect((await j(res)).code).toBe('PLAN_LIMIT');
    const [row] = await sql!`select title from tasks where id = ${free.taskId}::uuid`;
    expect(row!['title']).toBe('a free task');
  });

  it('the upload lanes answer 409 PLAN_LIMIT: POST /v1/messages, POST /v1/whiteboards, PATCH /v1/whiteboards/:id', async () => {
    const msg = await message(free);
    expect(msg.status).toBe(409);
    expect(await j(msg)).toEqual({ error: GATE_REFUSAL, code: 'PLAN_LIMIT' });
    const wb = await board(free);
    expect(wb.status).toBe(409);
    expect((await j(wb)).code).toBe('PLAN_LIMIT');
    const patch = await app!.request(`/v1/whiteboards/${free.whiteboardId}`, { method: 'PATCH', headers: hdr(owner), body: JSON.stringify({ rev: 2, title: 'renamed' }) });
    expect(patch.status).toBe(409);
    const [row] = await sql!`select title from whiteboards where id = ${free.whiteboardId}::uuid`;
    expect(row!['title']).toBe('gate board');
  });

  it('a free workspace still registers and heartbeats a machine', async () => {
    const reg = await send(owner, { type: 'machine.register', workspace: free.id, name: 'gated-mac', platform: 'darwin', daemonVersion: '0.0.0' });
    expect(reg.status).toBe(200);
    const { machineId } = await j(reg);
    expect((await send(owner, { type: 'machine.heartbeat', machineId, activeSeconds: 1 })).status).toBe(200);
  });

  it('a free workspace still reads: GET /v1/workspaces and GET /v1/tasks/:id', async () => {
    const list = await app!.request('/v1/workspaces', { headers: hdr(owner) });
    expect(list.status).toBe(200);
    const mine = (await j(list)).workspaces.find((w: { id: string }) => w.id === free.id);
    expect(mine).toMatchObject({ role: 'owner', plan: 'free' });
    const task = await app!.request(`/v1/tasks/${free.taskId}`, { headers: hdr(owner) });
    expect(task.status).toBe(200);
    expect((await j(task)).task.title).toBe('a free task');
  });

  it('a free workspace still exports', async () => {
    const res = await app!.request(`/v1/workspaces/${free.id}/export`, { headers: hdr(owner) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/gzip');
    await res.arrayBuffer();
  });

  it('a cloud workspace is untouched', async () => {
    expect((await send(owner, { type: 'task.create', workspace: cloud.id, channel: 'general', title: 'cloud writes' })).status).toBe(200);
    expect((await message(cloud)).status).toBe(200);
    expect((await board(cloud)).status).toBe(200);
  });

  it('flag off: the free workspace writes as before', async () => {
    delete process.env['NM_HOSTED_FREE_GATE'];
    expect((await send(owner, { type: 'task.create', workspace: free.id, channel: 'general', title: 'flag off' })).status).toBe(200);
    expect((await message(free)).status).toBe(200);
  });

  it('NM_LOCAL=1 with the flag on: nothing changes', async () => {
    process.env['NM_LOCAL'] = '1';
    expect((await send(owner, { type: 'task.create', workspace: free.id, channel: 'general', title: 'local mode' })).status).toBe(200);
    expect((await message(free)).status).toBe(200);
  });
});
