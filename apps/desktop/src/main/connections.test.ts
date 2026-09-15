// The connections registry: which backends exist for a launch, whose URL wins, where each
// replica lives, and the in-process foreground swap. Run from apps/desktop:
//   pnpm exec tsx --test src/main/connections.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localIsDormant,
  pickForeground,
  connections, makeConnection, parseConnectionsStore, planConnections, readConnectionsStore, resolveUrls,
  statePathsFor, writeConnectionsStore, DEV_WS, LOCAL_PORTS, type ConnectionSpec, localPortsFor } from './connections';

const BAKED = { apiUrl: 'https://api.neuramesh.app', powersyncUrl: 'https://ps.neuramesh.app', webUrl: 'https://neuramesh.app' };
const spec = (id: string, over: Partial<ConnectionSpec> = {}): ConnectionSpec =>
  ({ id, kind: 'custom', authMode: 'clerk', apiUrl: `https://${id}.example`, powersyncUrl: `https://ps-${id}.example`, webUrl: '', ...over });
const paths = (id: string) => ({ replicaPath: `/p/state/replica-${id}.db`, markerPath: `/p/identity/workspaces-${id}.json` });

beforeEach(() => connections.reset());

// ── precedence: env in dev → the connection's own values → the baked defaults ──
test('resolveUrls: env wins for a cloud connection, then its own values, then baked', () => {
  const env = { NM_API: 'http://127.0.0.1:8788', NM_POWERSYNC: 'http://127.0.0.1:58081' };
  assert.deepEqual(resolveUrls('cloud', env, { apiUrl: 'https://own.example', webUrl: 'https://own-web.example' }, BAKED), {
    apiUrl: 'http://127.0.0.1:8788', powersyncUrl: 'http://127.0.0.1:58081', webUrl: 'https://own-web.example',
  });
  assert.deepEqual(resolveUrls('cloud', {}, { apiUrl: 'https://own.example' }, BAKED), { ...BAKED, apiUrl: 'https://own.example' });
  assert.deepEqual(resolveUrls('cloud', {}, null, BAKED), BAKED);
});

test('resolveUrls: a blank env value does not shadow the rungs below it', () => {
  assert.equal(resolveUrls('cloud', { NM_API: '  ' }, null, BAKED).apiUrl, BAKED.apiUrl);
});

test('resolveUrls: the local stack ignores NM_API — its address is its ports', () => {
  const local = { apiUrl: `http://127.0.0.1:${LOCAL_PORTS.api}`, powersyncUrl: `http://127.0.0.1:${LOCAL_PORTS.powersync}`, webUrl: '' };
  assert.deepEqual(resolveUrls('local', { NM_API: 'https://elsewhere.example' }, null, local), local);
});

// ── which connections exist ──
test('planConnections: NM_AUTH=dev is one dev connection at the dev stack, env URLs honoured', () => {
  const plan = planConnections({ NM_AUTH: 'dev', NM_API: 'http://127.0.0.1:9999' }, { clerkSignedIn: true, custom: [], baked: BAKED });
  assert.equal(plan.length, 1);
  assert.equal(plan[0]!.id, 'dev');
  assert.equal(plan[0]!.authMode, 'dev');
  assert.equal(plan[0]!.apiUrl, 'http://127.0.0.1:9999');
  assert.equal(plan[0]!.powersyncUrl, `http://127.0.0.1:${LOCAL_PORTS.powersync}`);
});

test('planConnections: NM_AUTH=clerk is the cloud alone (sign-in first, exactly as before)', () => {
  const plan = planConnections({ NM_AUTH: 'clerk' }, { clerkSignedIn: false, custom: [], baked: BAKED });
  assert.deepEqual(plan.map((c) => [c.id, c.kind, c.authMode]), [['cloud', 'cloud', 'clerk']]);
  assert.equal(plan[0]!.apiUrl, BAKED.apiUrl);
});

test('planConnections: the shipped app is Local mode, plus the cloud once a Clerk session exists', () => {
  const signedOut = planConnections({}, { clerkSignedIn: false, custom: [], baked: BAKED });
  assert.deepEqual(signedOut.map((c) => c.id), ['local']);
  assert.equal(signedOut[0]!.authMode, 'local');
  assert.equal(signedOut[0]!.apiUrl, `http://127.0.0.1:${LOCAL_PORTS.api}`);
  const signedIn = planConnections({}, { clerkSignedIn: true, custom: [{ id: 'hq', apiUrl: 'https://hq.example' }], baked: BAKED });
  assert.deepEqual(signedIn.map((c) => c.id), ['local', 'cloud', 'custom:hq']);
  assert.equal(signedIn[1]!.apiUrl, BAKED.apiUrl);
  assert.equal(signedIn[2]!.apiUrl, 'https://hq.example');
  assert.equal(signedIn[2]!.powersyncUrl, BAKED.powersyncUrl, 'a custom server without its own PowerSync falls to baked');
});

// ── where the state lives ──
test('statePathsFor: dev and cloud keep the profile paths, every other connection gets its own files', () => {
  const primary = { replicaPath: '/p/brain/state/replica.db', markerPath: '/p/brain/identity/workspaces.json' };
  assert.deepEqual(statePathsFor({ id: 'cloud', kind: 'cloud' }, primary), primary);
  assert.deepEqual(statePathsFor({ id: 'dev', kind: 'custom' }, primary), primary);
  assert.deepEqual(statePathsFor({ id: 'local', kind: 'local' }, primary), { replicaPath: '/p/brain/state/replica-local.db', markerPath: '/p/brain/identity/workspaces-local.json' });
  assert.deepEqual(statePathsFor({ id: 'custom:hq', kind: 'custom' }, primary), { replicaPath: '/p/brain/state/replica-custom-hq.db', markerPath: '/p/brain/identity/workspaces-custom-hq.json' });
});

test('makeConnection: the dev lane is pinned to the seed; every other lane starts unresolved', () => {
  const dev = makeConnection(spec('dev', { authMode: 'dev' }), paths('dev'), 'u-dev');
  assert.equal(dev.ws, DEV_WS);
  assert.equal(dev.wsAuthoritative, true);
  assert.equal(dev.identity.actorId, 'u-dev');
  const local = makeConnection(spec('local', { kind: 'local', authMode: 'local' }), paths('local'));
  assert.equal(local.ws, '');
  assert.equal(local.wsAuthoritative, false);
  assert.equal(local.db, null);
  assert.equal(local.agentHostStarted, false);
});

// ── the registry ──
test('current() throws before any connection exists, then names the first added', () => {
  assert.throws(() => connections.current(), /no connection/);
  assert.equal(connections.peek(), null);
  const a = connections.add(makeConnection(spec('a'), paths('a')));
  connections.add(makeConnection(spec('b'), paths('b')));
  assert.equal(connections.current(), a);
  assert.equal(connections.all().length, 2);
  assert.equal(connections.byApiUrl('https://b.example')?.id, 'b');
});

test('setForeground swaps in place, fires listeners once, and reports its time', () => {
  const a = connections.add(makeConnection(spec('a'), paths('a')));
  const b = connections.add(makeConnection(spec('b'), paths('b')));
  const seen: string[] = [];
  connections.onForeground((c, prev) => seen.push(`${prev?.id ?? '-'}→${c.id}`));
  const r = connections.setForeground('b');
  assert.equal(connections.current(), b);
  assert.equal(r.changed, true);
  assert.ok(r.ms >= 0 && r.ms < 100, `swap took ${r.ms}ms`);
  assert.deepEqual(seen, ['a→b']);
  assert.equal(connections.setForeground('b').changed, false, 'the same connection again is a no-op');
  assert.deepEqual(seen, ['a→b']);
  assert.throws(() => connections.setForeground('nope'), /no connection nope/);
  assert.equal(connections.current(), b);
  assert.equal(a.db, null);
});

test('setForeground with a workspace stands in it — only one the connection belongs to', () => {
  const a = connections.add(makeConnection(spec('a'), paths('a')));
  a.session.wsMemberships = [{ id: 'w1', name: 'One', slug: 'one' }, { id: 'w2', name: 'Two', slug: 'two' }];
  a.ws = 'w1';
  const r = connections.setForeground('a', 'w2');
  assert.equal(r.changed, true);
  assert.equal(a.ws, 'w2');
  assert.deepEqual(a.wsInfo, { name: 'Two', slug: 'two' });
  assert.throws(() => connections.setForeground('a', 'w9'), /not a member/);
  assert.equal(a.ws, 'w2');
});

test('remove() drops a connection and moves the foreground to what is left', () => {
  connections.add(makeConnection(spec('a'), paths('a')));
  connections.add(makeConnection(spec('b'), paths('b')));
  connections.setForeground('b');
  connections.remove('b');
  assert.equal(connections.current().id, 'a');
  assert.throws(() => connections.add(makeConnection(spec('a'), paths('a'))), /already exists/);
});

// ── the store ──
test('the connections store round-trips and tolerates garbage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-conn-'));
  assert.deepEqual(readConnectionsStore(dir), { foreground: null, custom: [] });
  writeConnectionsStore(dir, { foreground: 'cloud', custom: [{ id: 'hq', apiUrl: 'https://hq.example' }] });
  assert.deepEqual(readConnectionsStore(dir), { foreground: 'cloud', custom: [{ id: 'hq', apiUrl: 'https://hq.example' }] });
  writeFileSync(join(dir, 'connections.json'), 'not json');
  assert.deepEqual(readConnectionsStore(dir), { foreground: null, custom: [] });
  assert.deepEqual(parseConnectionsStore(JSON.stringify({ foreground: 7, custom: [{ id: 'x' }, null, { id: 'ok', apiUrl: 'https://ok' }] })), { foreground: null, custom: [{ id: 'ok', apiUrl: 'https://ok' }] });
});

test('onChanged fires when a connection is added, removed, or told its replica opened (U3b: the rail\'s union re-scans)', () => {
  let n = 0;
  const off = connections.onChanged(() => n++);
  connections.add(makeConnection(spec('a'), paths('a')));
  assert.equal(n, 1);
  connections.add(makeConnection(spec('b'), paths('b')));
  assert.equal(n, 2);
  connections.notify();
  assert.equal(n, 3, 'boot tells the registry when a replica opens — the union has nothing to read before that');
  connections.remove('a');
  assert.equal(n, 4);
  off();
  connections.remove('b');
  assert.equal(n, 4, 'an unsubscribed listener hears nothing');
});

test('pickForeground: the stored choice wins, then the cloud, then the first — a Pro user stays where they were', () => {
  assert.equal(pickForeground('local', ['local', 'cloud']), 'local');
  assert.equal(pickForeground('gone', ['local', 'cloud']), 'cloud');
  assert.equal(pickForeground(null, ['local', 'cloud']), 'cloud');
  assert.equal(pickForeground(null, ['local']), 'local');
  assert.equal(pickForeground(null, ['dev']), 'dev');
  assert.equal(pickForeground(null, []), null);
});

test('localIsDormant: Local boots when it is the foreground or when this Mac ran the stack before, never otherwise', () => {
  assert.equal(localIsDormant('local', false), false);
  assert.equal(localIsDormant('cloud', true), false);
  assert.equal(localIsDormant('cloud', false), true);
  assert.equal(localIsDormant(null, false), true);
});

test('the local stack\'s two ports move with NM_LOCAL_API_PORT and NM_LOCAL_POWERSYNC_PORT, and the local connection follows them', () => {
  assert.deepEqual(localPortsFor({}), { api: 8788, powersync: 58081 });
  assert.deepEqual(localPortsFor({ NM_LOCAL_API_PORT: '8795', NM_LOCAL_POWERSYNC_PORT: '58095' }), { api: 8795, powersync: 58095 });
  assert.deepEqual(localPortsFor({ NM_LOCAL_API_PORT: 'nope', NM_LOCAL_POWERSYNC_PORT: '0' }), { api: 8788, powersync: 58081 });
  const [local] = planConnections({ NM_LOCAL_API_PORT: '8795', NM_LOCAL_POWERSYNC_PORT: '58095' }, { clerkSignedIn: false, custom: [], baked: { apiUrl: 'https://api.example', powersyncUrl: 'https://ps.example', webUrl: 'https://web.example' } });
  assert.equal(local!.apiUrl, 'http://127.0.0.1:8795');
  assert.equal(local!.powersyncUrl, 'http://127.0.0.1:58095');
});
