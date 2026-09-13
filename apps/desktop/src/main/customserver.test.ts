// The custom server validator: a bad address, a bad nm-config, a bad bearer, a good pair, and the
// boot hook that reads the bearer back.   pnpm exec tsx --test src/main/customserver.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customBearerAccount, customReachable, customServerId, validateCustomServer } from './customserver';
import { memoryKeychain } from './keychain';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CFG = { mode: 'local', powersyncUrl: 'http://box.local:58081', version: '0.132.0', schemaVersion: '0140' };
const ME = { actor: { kind: 'human', id: 'u-local' }, workspaces: [{ id: 'w1', name: 'Box', slug: 'box' }] };

/** a fake server: nm-config and /v1/me by path, the bearer it accepts */
const server = (over: { cfg?: unknown; cfgStatus?: number; bearer?: string; me?: unknown } = {}): typeof fetch => async (url, init) => {
  const u = String(url);
  if (u.endsWith('/.well-known/nm-config')) return json(over.cfg ?? CFG, over.cfgStatus ?? 200);
  if (u.endsWith('/v1/me')) {
    const auth = (init?.headers as Record<string, string> | undefined)?.['authorization'];
    if (auth !== `Bearer ${over.bearer ?? 'nmh_good'}`) return json({ error: 'AUTH_REQUIRED' }, 401);
    return json(over.me ?? ME);
  }
  return json({ error: 'not found' }, 404);
};

test('a good pair: the address answers with a mode, the bearer names a human, the PowerSync address comes from the server', async () => {
  const v = await validateCustomServer({ apiUrl: 'http://box.local:8788/', bearer: ' nmh_good ' }, server());
  assert.deepEqual(v, { ok: true, apiUrl: 'http://box.local:8788', powersyncUrl: 'http://box.local:58081', mode: 'local', version: '0.132.0', actorId: 'u-local', workspaces: ME.workspaces });
});

test('a pasted PowerSync address wins over the server-named one', async () => {
  const v = await validateCustomServer({ apiUrl: 'https://nm.example', powersyncUrl: 'https://ps.example/', bearer: 'nmh_good' }, server());
  assert.ok(v.ok && v.powersyncUrl === 'https://ps.example');
});

test('a bad nm-config: no mode, or not a NeuraMesh API at all', async () => {
  const noMode = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, server({ cfg: { version: '1' } }));
  assert.deepEqual(noMode, { ok: false, code: 'NM_CONFIG', message: 'The address did not answer as a NeuraMesh API. It has no mode.' });
  const notApi = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, server({ cfgStatus: 404 }));
  assert.ok(!notApi.ok && notApi.code === 'NM_CONFIG');
  const html = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, async () => new Response('<html>', { status: 200 }));
  assert.ok(!html.ok && html.code === 'NM_CONFIG');
});

test('a bad bearer: refused, or not a human', async () => {
  const wrong = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_wrong' }, server());
  assert.deepEqual(wrong, { ok: false, code: 'BEARER', message: 'The server did not accept the bearer.' });
  const agent = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, server({ me: { actor: { kind: 'agent', id: 'a1' }, workspaces: [] } }));
  assert.ok(!agent.ok && agent.code === 'BEARER');
  const blank = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: '  ' }, server());
  assert.ok(!blank.ok && blank.code === 'BEARER');
});

test('a bad address: not a url, a file scheme, or nothing answers', async () => {
  const junk = await validateCustomServer({ apiUrl: 'box.local', bearer: 'nmh_good' }, server());
  assert.ok(!junk.ok && junk.code === 'ADDRESS');
  const file = await validateCustomServer({ apiUrl: 'file:///etc', bearer: 'nmh_good' }, server());
  assert.ok(!file.ok && file.code === 'ADDRESS');
  const dead = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, async () => { throw new TypeError('fetch failed'); });
  assert.deepEqual(dead, { ok: false, code: 'UNREACHABLE', message: 'The address did not answer.' });
  const noPs = await validateCustomServer({ apiUrl: 'https://nm.example', bearer: 'nmh_good' }, server({ cfg: { mode: 'local' } }));
  assert.ok(!noPs.ok && noPs.code === 'ADDRESS');
});

test('the id and the keychain account derive from the host, so one server has one slot', () => {
  assert.equal(customServerId('http://box.local:8788/'), 'box.local:8788'.replace(':', '-'));
  assert.equal(customServerId('https://NM.Example.com'), 'nm.example.com');
  assert.equal(customBearerAccount('box.local-8788'), 'custom-bearer:box.local-8788');
});

test('the boot hook reads the bearer from the keychain into memory and names the actor from /v1/me', async () => {
  const kc = memoryKeychain({ [customBearerAccount('box.local-8788')]: 'nmh_good' });
  const c = { id: 'custom:box.local-8788', apiUrl: 'http://box.local:8788', identity: { actorId: '', display: '' } } as { id: string; apiUrl: string; bearer?: string; identity: { actorId: string; display: string } };
  await customReachable(c, kc, server());
  assert.equal(c.bearer, 'nmh_good');
  assert.deepEqual(c.identity, { actorId: 'u-local', display: 'box.local:8788' });
  const missing = { ...c, id: 'custom:other', bearer: undefined };
  await assert.rejects(customReachable(missing, kc, server()), /no bearer in the keychain/);
});
