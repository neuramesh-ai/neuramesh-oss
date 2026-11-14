import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Actor, FinanceAccount } from '@neuramesh/shared';
import { financeRoutes } from '../src/finance';
import { MemoryStore } from '../src/store';

const workspace = 'a0000000-0000-0000-0000-00000000000a';
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const session = 'c9f840a9-ad45-4362-a96c-1df638199c44';
const identity = { id: 'user_kinshi', email: 'kinshi@example.test' };
const expiresAt = '2099-01-01T00:00:00.000Z';
const original = { ...process.env };
describe('personal Finance boundary', () => {
  beforeEach(() => { process.env.NM_KINSHI_ORIGIN = 'https://www.kinshi.app'; process.env.NM_KINSHI_PARTNER_SECRET = 'test-partner-secret'.repeat(3); process.env.NM_CONNECTOR_KEY = 'test-sealing-key'.repeat(3); });
  afterEach(() => { process.env = { ...original }; });
  function fixture() {
    const store = new MemoryStore(); store.destinations.directory = async w => w === workspace ? [{ id:owner,kind:'human',name:'Owner',role:'owner',description:null,owner:true },{ id:other,kind:'human',name:'Member',role:'member',description:null,owner:false }] : []; let state = 'pending'; let unavailable = false; const calls: Array<{ path: string; body: any; secret: string | null }> = [];
    const remote: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname; const body = JSON.parse(String(init?.body)); const headers = new Headers(init?.headers);
      calls.push({ path, body, secret: headers.get('x-kinshi-session') });
      if (unavailable) return new Response('{}', { status: 503 });
      if (path.endsWith('/setup')) return Response.json({ id: session });
      if (path.endsWith('/revoke')) { state = 'revoked'; return Response.json({ ok: true }); }
      if (path.endsWith('/activate')) { if (body.identity !== identity.id) return new Response('{}', { status: 409 }); state = 'connected'; }
      if (path.endsWith('/accounts')) return Response.json({ accounts: [{ id: 'account', name: 'Checking', mask: '1234', type: 'depository', currency: 'CAD', current: 0, available: null, syncedAt: null, needsReconnect: false, plaidAccessToken: 'must-be-stripped' }] });
      return Response.json({ state, identity: state === 'pending' ? null : identity, accountCount: state === 'pending' ? 0 : 1, expiresAt, serverSecret: 'must-be-stripped' });
    };
    const app = new Hono<{ Variables: { actor: Actor } }>();
    app.use('*', async (c, next) => { c.set('actor', { kind: c.req.header('agent') ? 'agent' : 'human', id: c.req.header('owner') ?? owner }); await next(); });
    financeRoutes(app, store, { fetch: remote });
    const post = (action: string, body = {}, id = owner, agent = false) => app.request(`/v1/finance/${action}`, { method: 'POST', headers: { owner: id, ...(agent ? { agent: '1' } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ workspace,...body }) });
    return { post, store, calls, setState: (s: string) => { state = s; }, setUnavailable: () => { unavailable = true; } };
  }
  it('rejects agents and never lets a second person read, confirm or revoke the owner connection', async () => {
    const f = fixture(); expect((await f.post('start', { intent: 'connect' }, owner, true)).status).toBe(403);
    expect((await f.post('start', { intent: 'connect' })).status).toBe(200);
    expect((await f.post('status', {}, other)).status).toBe(403);
    expect((await f.post('accounts', {}, other)).status).toBe(403);
    await f.post('disconnect', {}, other); expect(f.calls.some(c => c.path.endsWith('/revoke'))).toBe(false);
  });
  it('resumes a setup with encrypted server-only credentials and requires explicit identity confirmation', async () => {
    const f = fixture(); const first = await (await f.post('start', { intent: 'create' })).json() as { url: string };
    expect(first.url).toContain('/neuramesh/connect/'); expect(JSON.stringify(first)).not.toContain('secret');
    const stored = await f.store.finance.withWorkspace(workspace,owner, async link => link!);
    expect(stored.sealedSecret).not.toContain(f.calls[0]!.body.secret);
    expect(await (await f.post('start', { intent: 'connect' })).json()).toEqual(first); expect(f.calls.filter(c => c.path.endsWith('/setup'))).toHaveLength(1);
    f.setState('confirmation'); expect((await f.post('confirm', { identity: 'wrong' })).status).toBe(409);
    const status = await (await f.post('confirm', { identity: identity.id })).json() as { state: string }; expect(status.state).toBe('connected'); expect(status).not.toHaveProperty('serverSecret');
    const data = await (await f.post('accounts')).json() as { accounts: FinanceAccount[] }; expect(data.accounts[0]!.current).toBe(0); expect(data.accounts[0]!.available).toBeNull(); expect(data.accounts[0]).not.toHaveProperty('plaidAccessToken');
  });
  it('does not read financial records before final identity confirmation', async () => {
    const f = fixture(); await f.post('start', { intent: 'create' });
    for (const state of ['pending', 'confirmation', 'expired', 'revoked']) {
      f.setState(state); expect((await f.post('accounts')).status).toBe(409);
    }
    expect(f.calls.some(c => c.path.endsWith('/accounts'))).toBe(false);
  });
  it('rejects invalid or insecure partner origins before making a network request', async () => {
    const f = fixture();
    for (const origin of ['not a URL', 'http://www.kinshi.app', 'https://www.kinshi.app/other', 'https://user:password@www.kinshi.app']) {
      process.env.NM_KINSHI_ORIGIN = origin;
      expect(await (await f.post('status')).json()).toEqual({ state: 'unconfigured' });
    }
    expect(f.calls).toHaveLength(0);
  });
  it('keeps the credential when remote revocation fails so retry can revoke the actual grant', async () => {
    const f = fixture(); await f.post('start', { intent: 'connect' }); f.setUnavailable();
    expect((await f.post('disconnect')).status).toBe(502);
    expect(await f.store.finance.withWorkspace(workspace,owner, async link => !!link)).toBe(true);
  });
  it('serializes concurrent starts into one durable setup and disconnects idempotently', async () => {
    const f = fixture(); await Promise.all([f.post('start', { intent: 'create' }), f.post('start', { intent: 'connect' })]);
    expect(f.calls.filter(c => c.path.endsWith('/setup'))).toHaveLength(1);
    expect((await f.post('disconnect')).status).toBe(200); expect((await f.post('disconnect')).status).toBe(200);
    expect(await (await f.post('status')).json()).toEqual({ state: 'disconnected' });
  });
  it('fails closed when server encryption or partner configuration is missing', async () => {
    delete process.env.NM_CONNECTOR_KEY; const f = fixture();
    expect(await (await f.post('status')).json()).toEqual({ state: 'unconfigured' }); expect((await f.post('start', { intent: 'create' })).status).toBe(503); expect(f.calls).toHaveLength(0);
  });
});
