// The connector reads ITS connection, never a process-wide singleton: the former POWERSYNC_URL
// and API_URL each became a field, and the auth mode decides the token per connection. Two
// connections in one process must sign and upload as themselves.
//   pnpm exec tsx --test src/main/sync/connector.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connections, makeConnection, type Connection, type ConnectionSpec } from '../connections';
import { Connector, fetchLocalCredentials, jwtExpiry } from './connector';

const spec = (id: string, over: Partial<ConnectionSpec> = {}): ConnectionSpec =>
  ({ id, kind: 'custom', authMode: 'dev', apiUrl: `https://${id}.example`, powersyncUrl: `https://ps-${id}.example`, webUrl: '', ...over });
const paths = (id: string) => ({ replicaPath: `/p/replica-${id}.db`, markerPath: `/p/workspaces-${id}.json` });
const add = (id: string, over: Partial<ConnectionSpec> = {}): Connection => connections.add(makeConnection(spec(id, over), paths(id), `u-${id}`));

const jwt = (payload: object) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => connections.reset());

test('POWERSYNC_URL became a field: the dev token names the CONNECTION\'s endpoint and actor', async () => {
  const a = add('a');
  add('b');
  const cred = await new Connector(a, (c) => c.identity.actorId).fetchCredentials();
  assert.equal(cred.endpoint, 'https://ps-a.example');
  const payload = JSON.parse(Buffer.from(cred.token.split('.')[1]!, 'base64url').toString()) as { sub: string; aud: string };
  assert.equal(payload.sub, 'u-a');
  assert.equal(payload.aud, 'powersync-dev');
});

test('a local connection mints its sync token from the stack with the nmh_ bearer, and never signs with the dev key', async () => {
  const a = add('local', { kind: 'local', authMode: 'local', apiUrl: 'http://127.0.0.1:8788', powersyncUrl: 'http://127.0.0.1:58081' });
  a.bearer = 'nmh_' + 'a'.repeat(48);
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const token = jwt({ sub: 'u-local', exp: Math.floor(Date.now() / 1000) + 600 });
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)['authorization'] });
    return jsonRes({ token, endpoint: 'http://127.0.0.1:58081' });
  }) as typeof fetch;
  const cred = await new Connector(a, (c) => c.identity.actorId, fetchImpl).fetchCredentials();
  assert.deepEqual(calls, [{ url: 'http://127.0.0.1:8788/auth/local/token', auth: `Bearer ${a.bearer}` }]);
  assert.equal(cred.token, token);
  assert.equal(cred.endpoint, 'http://127.0.0.1:58081');
  assert.ok(cred.expiresAt && cred.expiresAt.getTime() > Date.now(), 'the SDK gets an expiry to refresh ahead of');
});

test('the local token lane refuses out loud without a bearer, and names a server refusal', async () => {
  const a = add('local', { kind: 'local', authMode: 'local' });
  await assert.rejects(fetchLocalCredentials(a, (async () => jsonRes({})) as typeof fetch), /bearer not loaded/);
  a.bearer = 'nmh_x';
  await assert.rejects(fetchLocalCredentials(a, (async () => jsonRes({ error: 'bad bearer' }, 401)) as typeof fetch), /bad bearer/);
  // the server's own endpoint wins; a silent one falls back to the connection's
  const cred = await fetchLocalCredentials(a, (async () => jsonRes({ token: 'tok' })) as typeof fetch);
  assert.equal(cred.endpoint, a.powersyncUrl);
  assert.equal(cred.expiresAt, undefined);
});

test('jwtExpiry reads exp, and an unreadable token is honestly undefined', () => {
  assert.equal(jwtExpiry(jwt({ exp: 1_800_000_000 }))?.getTime(), 1_800_000_000_000);
  assert.equal(jwtExpiry('not.a.jwt'), undefined);
  assert.equal(jwtExpiry(jwt({})), undefined);
});

test('API_URL became a field: an upload on connection A dials A, carries A\'s credential, and never touches B', async () => {
  const a = add('a', { kind: 'local', authMode: 'local', apiUrl: 'http://127.0.0.1:8788' });
  a.bearer = 'nmh_A';
  const b = add('b', { kind: 'local', authMode: 'local', apiUrl: 'http://127.0.0.1:9999' });
  b.bearer = 'nmh_B';
  connections.setForeground('b'); // the FOREGROUND is b — the upload still belongs to a
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)['authorization'] });
    return jsonRes({ ok: true });
  }) as typeof fetch;
  let completed = 0;
  const tx = {
    crud: [{ op: 'PUT', table: 'messages', id: 'm1', opData: { workspace_id: 'ws-a', channel_id: 'c1', body: 'hi', author_kind: 'human', author_id: 'u-a', created_at: 'now' } }],
    complete: async () => { completed++; },
  };
  let handed = false;
  const db = { getNextCrudTransaction: async () => { if (handed) return null; handed = true; return tx; } };
  await new Connector(a, (c) => c.identity.actorId, fetchImpl).uploadData(db as never);
  assert.equal(completed, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.startsWith('http://127.0.0.1:8788/'), `dialled ${calls[0]!.url}`);
  assert.equal(calls[0]!.auth, 'Bearer nmh_A');
  assert.ok(calls.every((c) => !c.url.includes('9999')), 'connection B was never dialled');
});
