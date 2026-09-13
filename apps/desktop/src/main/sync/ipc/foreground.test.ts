// THE HANDLER WALL READS THE FOREGROUND CONNECTION. The former singletons — `WS`, `activeDb`,
// `session`, `API_URL` — are getters now, and a handler registered ONCE at boot must answer for
// whichever connection is in front WHEN IT IS CALLED. These drive two real IPC modules through a
// stub `electron` with two connections registered, and prove a call on A never touches B's replica.
//   pnpm exec tsx --test src/main/sync/ipc/foreground.test.ts
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { connections, makeConnection, type Connection, type ConnectionSpec } from '../../connections';

// The IPC modules import `electron` at the top level (they only ever run inside it), so the
// test hands them a stub through the CJS loader: `ipcMain.handle` records the handler, and the
// test calls it the way the renderer's invoke would.
const handlers = new Map<string, (event: unknown, args: unknown) => unknown>();
const fakeElectron = { ipcMain: { handle: (name: string, fn: (event: unknown, args: unknown) => unknown) => { handlers.set(name, fn); }, removeHandler: () => {} } };
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === 'electron') return fakeElectron;
  return realLoad.call(this, request, ...rest);
};

type FakeDb = { queries: Array<{ sql: string; args: unknown[] }>; getAll: <T>(sql: string, args?: unknown[]) => Promise<T[]> };
const fakeDb = (rows: unknown[] = []): FakeDb => {
  const queries: FakeDb['queries'] = [];
  return { queries, getAll: async <T>(sql: string, args: unknown[] = []) => { queries.push({ sql, args }); return rows as T[]; } };
};
const spec = (id: string): ConnectionSpec => ({ id, kind: 'custom', authMode: 'dev', apiUrl: `https://${id}.example`, powersyncUrl: '', webUrl: '' });
const paths = (id: string) => ({ replicaPath: `/p/replica-${id}.db`, markerPath: `/p/workspaces-${id}.json` });
const addConn = (id: string, ws: string, db: FakeDb): Connection => {
  const c = connections.add(makeConnection(spec(id), paths(id), `u-${id}`));
  c.ws = ws;
  c.db = db as never;
  c.session.wsMemberships = [{ id: ws, name: `Workspace ${id}`, slug: id }];
  return c;
};
const invoke = <T>(name: string, args: unknown = {}): Promise<T> => {
  const h = handlers.get(name);
  if (!h) throw new Error(`no handler ${name}`);
  return Promise.resolve(h({}, args) as T);
};

// the getters exactly as sync.ts builds them — the ONE way a handler may reach the replica
const ws = () => connections.current().ws;
const db = () => connections.current().db as never as FakeDb;

let rooms: typeof import('./rooms');
let membership: typeof import('./membership');
before(async () => {
  rooms = await import('./rooms');
  membership = await import('./membership');
});
beforeEach(() => { connections.reset(); handlers.clear(); });

test('WS + activeDb became getters: nm:channels queries the FOREGROUND replica, scoped by its workspace', async () => {
  const dbA = fakeDb([{ id: 'ch-a', slug: 'general' }]);
  const dbB = fakeDb([{ id: 'ch-b', slug: 'general' }]);
  addConn('a', 'ws-a', dbA);
  addConn('b', 'ws-b', dbB);
  rooms.registerRoomIpc({ ws, db: db as never, loadRoster: async () => ({}) });

  const onA = await invoke<Array<{ id: string }>>('nm:channels');
  assert.deepEqual(onA.map((r) => r.id), ['ch-a']);
  assert.equal(dbA.queries.length, 1);
  assert.deepEqual(dbA.queries[0]!.args, ['ws-a']);
  assert.equal(dbB.queries.length, 0, 'a call while A is in front never touches B\'s replica');

  connections.setForeground('b');
  const onB = await invoke<Array<{ id: string }>>('nm:channels');
  assert.deepEqual(onB.map((r) => r.id), ['ch-b']);
  assert.equal(dbA.queries.length, 1, 'and the reverse');
  assert.deepEqual(dbB.queries[0]!.args, ['ws-b']);
});

test('session became a getter: nm:workspaces answers for the connection in front, not the one that booted first', async () => {
  addConn('a', 'ws-a', fakeDb());
  addConn('b', 'ws-b', fakeDb());
  const apiCalls: string[] = [];
  membership.registerMembershipIpc({
    ws, db: db as never,
    api: async (path: string) => { apiCalls.push(path); return { workspaces: connections.current().session.wsMemberships }; },
    session: () => connections.current().session,
    needsOnboarding: () => connections.current().needsOnboarding,
    apiUrl: () => connections.current().apiUrl,
    actorId: () => connections.current().identity.actorId,
    refreshPendingInvites: async () => {},
    switchWorkspace: (w) => { connections.setForeground(connections.current().id, w ?? undefined); return { ok: true, switching: true }; },
    connectionSummaries: () => [], setForeground: (id, w) => { connections.setForeground(id, w); return { ok: true, switching: true }; },
  });
  const a = await invoke<{ active: string; workspaces: Array<{ id: string }> }>('nm:workspaces');
  assert.equal(a.active, 'ws-a');
  assert.deepEqual(a.workspaces.map((w) => w.id), ['ws-a']);
  connections.setForeground('b');
  const b = await invoke<{ active: string; workspaces: Array<{ id: string }> }>('nm:workspaces');
  assert.equal(b.active, 'ws-b');
  assert.deepEqual(b.workspaces.map((w) => w.id), ['ws-b']);
  // the live-runs read goes to the foreground replica too
  await invoke('nm:live-runs');
  assert.deepEqual((connections.current().db as never as FakeDb).queries.at(-1)!.args, ['ws-b']);
  assert.equal((connections.get('a')!.db as never as FakeDb).queries.length, 0);
});

test('nm:switch-workspace refuses a workspace the foreground connection is not in, and stands in one it is', async () => {
  const a = addConn('a', 'ws-a', fakeDb());
  a.session.wsMemberships.push({ id: 'ws-a2', name: 'Second', slug: 'second' });
  membership.registerMembershipIpc({
    ws, db: db as never, api: async () => ({}),
    session: () => connections.current().session, needsOnboarding: () => false,
    apiUrl: () => connections.current().apiUrl, actorId: () => 'u', refreshPendingInvites: async () => {},
    switchWorkspace: (w) => { connections.setForeground(connections.current().id, w ?? undefined); return { ok: true, switching: true }; },
    connectionSummaries: () => [], setForeground: (id, w) => { connections.setForeground(id, w); return { ok: true, switching: true }; },
  });
  await assert.rejects(invoke('nm:switch-workspace', { workspace: 'ws-nope' }), /not a member/);
  await invoke('nm:switch-workspace', { workspace: 'ws-a2' });
  assert.equal(ws(), 'ws-a2');
  assert.deepEqual(connections.current().wsInfo, { name: 'Second', slug: 'second' });
});

test('nm:set-foreground (U3b): the swap call carries { connectionId, workspaceId } and lands the shell on that connection\'s workspace', async () => {
  addConn('a', 'ws-a', fakeDb());
  const b = addConn('b', 'ws-b', fakeDb());
  b.session.wsMemberships.push({ id: 'ws-b2', name: 'B two', slug: 'b2' });
  const calls: Array<[string, string | undefined]> = [];
  membership.registerMembershipIpc({
    ws, db: db as never, api: async () => ({}),
    session: () => connections.current().session, needsOnboarding: () => false,
    apiUrl: () => connections.current().apiUrl, actorId: () => 'u', refreshPendingInvites: async () => {},
    switchWorkspace: (w) => { connections.setForeground(connections.current().id, w ?? undefined); return { ok: true, switching: true }; },
    connectionSummaries: () => connections.all().map((c) => ({ id: c.id, kind: c.kind, authMode: c.authMode, host: c.apiUrl, workspaceId: c.ws, workspace: c.wsInfo, workspaces: c.session.wsMemberships, account: null, live: !!c.db })),
    setForeground: (id, w) => { calls.push([id, w]); connections.setForeground(id, w); return { ok: true, switching: true }; },
  });
  const list = await invoke<Array<{ id: string; workspaceId: string; workspaces: Array<{ id: string }> }>>('nm:connections');
  assert.deepEqual(list.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(list[1]!.workspaces.map((w) => w.id), ['ws-b', 'ws-b2'], 'the menu lists every workspace of every connection');
  await invoke('nm:set-foreground', { connectionId: 'b', workspaceId: 'ws-b2' });
  assert.deepEqual(calls, [['b', 'ws-b2']]);
  assert.equal(connections.current().id, 'b');
  assert.equal(ws(), 'ws-b2');
  // a null workspace means "the one it stands in" — the row's connection, nothing else
  await invoke('nm:set-foreground', { connectionId: 'a', workspaceId: null });
  assert.deepEqual(calls.at(-1), ['a', undefined]);
  assert.equal(ws(), 'ws-a');
  await assert.rejects(() => invoke('nm:set-foreground', { connectionId: 'b', workspaceId: 'ws-nope' }), /not a member/);
});
