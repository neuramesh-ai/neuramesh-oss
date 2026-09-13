// The hosted write gate (source release 2026-09, unit U1b): a `free` workspace on the hosted
// API reads but does not write, and the refusal SHAPE is per lane. Commands answer 402
// PLAN_LIMIT (the desktop routes that code to the upgrade flow). The PowerSync upload lanes
// answer 409 PLAN_LIMIT, because the uploader drops a 409 and retries anything else while
// holding every download behind it (apps/desktop/src/main/sync/upload.ts throwUnless409):
// a 402 there would wedge an old client's replica behind one refused message.
//
// The exemption list is tested one entry at a time. Every GET passes. Off by default, and
// never on under NM_LOCAL. The pg lane (hosted-gate.pg.test.ts) proves the same against the
// real schema and the id-to-workspace resolver.
import type { Actor } from '@neuramesh/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { GATE_EXEMPT_COMMANDS, GATE_EXEMPT_ROUTES, GATE_REFUSAL, gateActive, refusalStatus } from '../src/hosted-gate';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const hdr = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

describe('gateActive reads the flag and the local override', () => {
  const env = { flag: process.env['NM_HOSTED_FREE_GATE'], local: process.env['NM_LOCAL'] };
  afterEach(() => {
    if (env.flag === undefined) delete process.env['NM_HOSTED_FREE_GATE']; else process.env['NM_HOSTED_FREE_GATE'] = env.flag;
    if (env.local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = env.local;
  });

  it('is off with no flag, on with the flag, and never on under NM_LOCAL (localmode.ts)', () => {
    delete process.env['NM_HOSTED_FREE_GATE']; delete process.env['NM_LOCAL'];
    expect(gateActive()).toBe(false);
    process.env['NM_HOSTED_FREE_GATE'] = '0';
    expect(gateActive()).toBe(false);
    process.env['NM_HOSTED_FREE_GATE'] = '1';
    expect(gateActive()).toBe(true);
    process.env['NM_LOCAL'] = '1';
    expect(gateActive()).toBe(false);
  });
});

describe('the refusal shape per lane', () => {
  it.each([
    ['POST', '/v1/commands', 402],
    ['POST', '/v1/messages', 409],
    ['POST', '/v1/artifacts', 409],
    ['POST', '/v1/whiteboards', 409],
    ['PATCH', '/v1/whiteboards/0b8c1a2e-1111-4222-8333-444455556666', 409],
  ] as const)('%s %s answers %i', (method, path, status) => {
    expect(refusalStatus(method, path)).toBe(status);
  });

  it.each([
    '/v1/workspaces', '/v1/whiteboards', '/v1/whiteboards/abc', '/v1/tasks/abc', '/v1/memory', '/v1/credentials',
    '/v1/usage', '/v1/credits/history', '/v1/machines/usage', '/v1/x/search', '/v1/retro', '/v1/invites', '/v1/model-packs',
  ])('every GET passes: %s', (path) => {
    expect(refusalStatus('GET', path)).toBeNull();
  });

  it('a write lane the gate does not name passes (per-user and read-shaped POSTs)', () => {
    expect(refusalStatus('POST', '/v1/devices')).toBeNull();
    expect(refusalStatus('POST', '/v1/recall')).toBeNull();
  });
});

describe('the exemption list, one entry at a time', () => {
  it.each(GATE_EXEMPT_ROUTES.map((e) => [e.method, e.sample, e.why] as const))('%s %s passes: %s', (method, sample) => {
    expect(refusalStatus(method === 'ANY' ? 'POST' : method, sample)).toBeNull();
  });

  it('names exactly the routes the plan lists', () => {
    const samples = GATE_EXEMPT_ROUTES.map((e) => `${e.method} ${e.sample}`);
    expect(samples).toEqual([
      'ANY /auth/clerk',
      'ANY /v1/billing/checkout',
      'POST /v1/machines/sync-token',
      'GET /v1/workspaces',
      'GET /v1/me',
      'GET /v1/workspaces/0b8c1a2e-1111-4222-8333-444455556666/export',
    ]);
  });

  it('names exactly the three commands a Free workspace still needs', () => {
    expect([...GATE_EXEMPT_COMMANDS].sort()).toEqual(['machine.heartbeat', 'machine.register', 'workspace.create']);
  });
});

describe('the gate on the app (memory store)', () => {
  const env = { flag: process.env['NM_HOSTED_FREE_GATE'], local: process.env['NM_LOCAL'] };
  let store: MemoryStore; let app: ReturnType<typeof createApp>; let ws: string;
  const create = (title: string) => app.request('/v1/commands', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ type: 'task.create', workspace: ws, channel: 'general', title }),
  });
  const message = () => app.request('/v1/messages', { method: 'POST', headers: hdr, body: JSON.stringify({ workspace: ws, channel: 'general', body: 'hi' }) });

  beforeEach(async () => {
    process.env['NM_HOSTED_FREE_GATE'] = '1';
    delete process.env['NM_LOCAL'];
    store = new MemoryStore();
    app = createApp(store);
    ws = (await store.createWorkspace({ name: 'Gated', slug: 'gated', createdBy: george.id }, { type: 'workspace.created' } as never)).workspaceId;
  });
  afterEach(() => {
    if (env.flag === undefined) delete process.env['NM_HOSTED_FREE_GATE']; else process.env['NM_HOSTED_FREE_GATE'] = env.flag;
    if (env.local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = env.local;
  });

  it('a free workspace: task.create is 402 PLAN_LIMIT with the refusal sentence, a message is 409 PLAN_LIMIT', async () => {
    const res = await create('gated');
    expect(res.status).toBe(402);
    expect(await j(res)).toEqual({ error: GATE_REFUSAL, code: 'PLAN_LIMIT' });
    const msg = await message();
    expect(msg.status).toBe(409);
    expect((await j(msg)).code).toBe('PLAN_LIMIT');
  });

  it('the same workspace on cloud writes', async () => {
    await store.setWorkspacePlan(ws, { plan: 'cloud' });
    expect((await create('cloud')).status).toBe(200);
  });

  it('workspace.create stays open: it is how a Free person gets a workspace at all', async () => {
    const res = await app.request('/v1/commands', { method: 'POST', headers: hdr, body: JSON.stringify({ type: 'workspace.create', name: 'Second', slug: 'second' }) });
    expect(res.status).toBe(200);
  });

  it('flag off: nothing changes', async () => {
    process.env['NM_HOSTED_FREE_GATE'] = '0';
    expect((await create('open')).status).toBe(200);
  });

  it('NM_LOCAL=1 with the flag on: nothing changes', async () => {
    process.env['NM_LOCAL'] = '1';
    expect((await create('local')).status).toBe(200);
  });

  it('the refusal sentence is ASD-STE100: no em dash, no semicolon, and it names Pro', () => {
    expect(GATE_REFUSAL).not.toMatch(/[—;]/);
    expect(GATE_REFUSAL).toBe('This workspace needs Pro. Your threads stay readable. Get Pro to write again.');
  });
});
