import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteReplica, type SQLiteDriver } from '@neuramesh/client-core/sqlite-replica';
import { createMachineReplica, machineReplicaIdentity } from './machined-replica';

const cfg = { apiUrl: 'http://api.test', workspaceId: 'workspace', ownerUserId: 'owner' };
const batch = (cursor = 'c1') => ({ schemaVersion: 1, changes: [], workspaces: ['workspace'], cursor, hasMore: false });

function memoryReplica(): SQLiteReplica {
  const db = new DatabaseSync(':memory:');
  const driver: SQLiteDriver = {
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (stmt.columns().length) return { rows: stmt.all(...params as never[]) };
      return { rows: [], rowsAffected: Number(stmt.run(...params as never[]).changes) };
    },
    async close() { db.close(); },
  };
  return new SQLiteReplica(driver);
}

const noHold = { start: (): unknown => null, stop: (): void => {} };

test('the identity names the owner and carries the token it is given', () => {
  const id = machineReplicaIdentity(cfg, 'nmm_a');
  assert.deepEqual(id.defaultActor, { kind: 'human', id: 'owner' });
  assert.equal(id.workspaceFallback, 'workspace');
  assert.deepEqual(id.authHeaders, { authorization: 'Bearer nmm_a', 'x-nm-agent-scopes': '1' });
});

test('connect holds the event loop until the first sync, then lets it go', async () => {
  const db = memoryReplica();
  const events: string[] = [];
  const hold = { start: (): unknown => { events.push('start'); return 'h'; }, stop: (h: unknown): void => { events.push(`stop:${String(h)}`); } };
  const replica = createMachineReplica(cfg, { db, token: () => 'nmm_a', hold, pollMs: 100_000, fetchImpl: (async () => Response.json(batch())) as typeof fetch });
  try {
    await replica.activate();
    await replica.connect();
    assert.deepEqual(events, ['start']);
    await db.waitForFirstSync();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(events, ['start', 'stop:h']);
  } finally { await db.close(); }
});

test('every pass reads the token as it is now, and a 401 renews it once before the next pass', async () => {
  const db = memoryReplica();
  let token = 'nmm_old';
  let refreshes = 0;
  const seen: string[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.['authorization'] ?? '');
    seen.push(auth);
    return auth === 'Bearer nmm_old' ? new Response('expired', { status: 401 }) : Response.json(batch());
  }) as typeof fetch;
  const replica = createMachineReplica(cfg, {
    db, token: () => token, hold: noHold, pollMs: 10, fetchImpl,
    refreshToken: async () => { refreshes += 1; token = 'nmm_new'; },
    log: () => {},
  });
  try {
    await replica.activate();
    await replica.connect();
    await db.waitForFirstSync();
    assert.equal(refreshes, 1);
    assert.equal(seen[0], 'Bearer nmm_old');
    assert.ok(seen.includes('Bearer nmm_new'));
  } finally { await db.close(); }
});

test('a refused token is renewed at most once per window', async () => {
  const db = memoryReplica();
  let refreshes = 0;
  let t = 0;
  const replica = createMachineReplica(cfg, {
    db, token: () => 'nmm_bad', hold: noHold, pollMs: 5, refreshGapMs: 60_000, now: () => t,
    fetchImpl: (async () => new Response('no', { status: 401 })) as typeof fetch,
    refreshToken: async () => { refreshes += 1; },
    log: () => {},
  });
  try {
    await replica.activate();
    await replica.connect();
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(refreshes, 1);
    t = 61_000;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(refreshes, 2);
  } finally { await db.close(); }
});

test('drainWrites waits for the outbox to reach the API, and throws when it cannot', async () => {
  const db = memoryReplica();
  let accept = false;
  let uploads = 0;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') { uploads += 1; return accept ? Response.json({ ok: true }) : new Response('unavailable', { status: 503 }); }
    return Response.json(batch());
  }) as typeof fetch;
  const replica = createMachineReplica(cfg, { db, token: () => 'nmm_a', hold: noHold, pollMs: 100_000, fetchImpl });
  try {
    await replica.activate();
    await replica.connect();
    await db.waitForFirstSync();
    await db.execute('insert into messages(id,workspace_id,author_kind,author_id,body) values (?,?,?,?,?)', ['m1', 'workspace', 'human', 'owner', 'queued']);
    await assert.rejects(replica.drainWrites(300), /still holds queued writes/);
    assert.ok(uploads >= 1);
    accept = true;
    await replica.drainWrites(5_000);
    assert.deepEqual(await db.getAll('select * from nm_outbox'), []);
  } finally { await db.close(); }
});

test('syncedAfter resolves once a sync completes after the given time', async () => {
  const db = memoryReplica();
  const replica = createMachineReplica(cfg, { db, token: () => 'nmm_a', hold: noHold, pollMs: 100_000, fetchImpl: (async () => Response.json(batch())) as typeof fetch });
  try {
    await replica.activate();
    const before = Date.now() - 1;
    await replica.connect();
    await replica.syncedAfter(before);
    assert.ok((db.currentStatus.lastSyncedAt?.getTime() ?? 0) > before);
  } finally { await db.close(); }
});
