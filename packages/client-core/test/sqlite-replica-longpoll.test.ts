// The replica's long-poll (sqlite-replica.ts waitForNews, ported from the round 6 desktop LocalReplica).
// Between passes it holds GET /v1/brain/replica/changes?wait=25 when the server says it can, applies
// what that brings, falls back to a pollMs sleep against a server without long-polls, honours the
// server's retry hint when it holds too many waits, backs off on errors, and a local write cuts the
// wait short so the outbox drains at once.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, afterEach } from 'vitest';
import { SQLiteReplica, type ReplicaConnection, type SQLiteDriver } from '../src/sqlite-replica';
import type { ReplicaBatch } from '../src/replica';

const ws = '00000000-0000-0000-0000-000000000001';
const owner = { kind: 'human' as const, id: '00000000-0000-0000-0000-0000000000aa' };
const message = (id: string, body: string) => ({ table: 'messages', id, row: { workspace_id: ws, author_kind: 'human', author_id: owner.id, body } });
const batch = (changes: ReplicaBatch['changes'], cursor: string, extra: Partial<ReplicaBatch> = {}): ReplicaBatch =>
  ({ schemaVersion: 1, changes, cursor, workspaces: [ws], hasMore: false, ...extra });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(10);
  }
}

function open(): SQLiteReplica {
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
const replicas: SQLiteReplica[] = [];
const create = () => { const r = open(); replicas.push(r); return r; };
afterEach(async () => { for (const db of replicas.splice(0)) await db.close(); });

type Call = { url: string; method: string; at: number };
/** a request the server holds until the client gives up */
const hang = (signal: AbortSignal): Promise<Response> => new Promise((_, reject) => {
  if (signal.aborted) return reject(signal.reason);
  signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
});
/** a fake API. `onWait` answers a long-poll, and it may hang until the request is aborted */
function api(handlers: { bootstrap?: () => ReplicaBatch; changes?: () => ReplicaBatch; onWait?: (signal: AbortSignal, n: number) => Promise<Response> }) {
  const calls: Call[] = [];
  let waits = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', at: Date.now() });
    if (init?.method === 'POST') return Response.json({ id: JSON.parse(String(init.body)).id });
    if (url.includes('/v1/brain/replica/bootstrap')) return Response.json(handlers.bootstrap?.() ?? batch([], 'c0', { wait: 25 }));
    if (url.includes('&wait=')) return handlers.onWait ? handlers.onWait(init!.signal!, waits++) : hang(init!.signal!);
    if (url.includes('/v1/brain/replica/changes')) return Response.json(handlers.changes?.() ?? batch([], 'c0', { wait: 25 }));
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const connection = (fetchImpl: typeof fetch, pollMs = 50): ReplicaConnection => ({
  apiUrl: 'http://test.local', pollMs, fetchImpl,
  identity: async () => ({ apiUrl: 'http://test.local', workspaceFallback: ws, defaultActor: owner, authHeaders: { authorization: 'Bearer t' } }),
});
const waits = (calls: Call[]) => calls.filter((c) => c.url.includes('&wait='));

describe('replica long-poll', () => {
  it('long-polls between passes when the server holds one, and applies what the wait brings without another request', async () => {
    let release!: () => void;
    const news = new Promise<void>((r) => { release = r; });
    const { calls, fetchImpl } = api({
      onWait: async (signal, n) => {
        if (n === 0) { await news; return Response.json(batch([message('m1', 'from the wait')], 'c1', { wait: 25 })); }
        return hang(signal);
      },
    });
    const db = create();
    await db.connect(connection(fetchImpl));
    await until(() => waits(calls).length === 1);
    expect(waits(calls)[0]!.url).toMatch(/\/v1\/brain\/replica\/changes\?cursor=c0&wait=25$/);
    const before = calls.length;
    release();
    await until(async () => (await db.getAll('select id from messages')).length === 1);
    await until(() => waits(calls).length === 2);
    expect(waits(calls)[1]!.url).toMatch(/cursor=c1&wait=25/);
    // the news cost no request beyond the next wait
    expect(calls.length).toBe(before + 1);
    expect(db.currentStatus.lastSyncedAt).toBeTruthy();
  });

  it('polls every pollMs against a server that does not hold long-polls (no wait field)', async () => {
    const { calls, fetchImpl } = api({ bootstrap: () => batch([], 'c0'), changes: () => batch([], 'c0') });
    const db = create();
    await db.connect(connection(fetchImpl, 50));
    await until(() => calls.filter((c) => c.url.includes('/v1/brain/replica/changes')).length >= 3);
    expect(waits(calls)).toHaveLength(0);
    const changes = calls.filter((c) => c.url.includes('/v1/brain/replica/changes'));
    // a pass downloads twice in a row (before and after its upload); the sleep sits between passes
    expect(changes[1]!.at - changes[0]!.at).toBeGreaterThanOrEqual(40);
  });

  it('a local write cuts the long-poll short and goes up at once', async () => {
    const { calls, fetchImpl } = api({});
    const db = create();
    await db.connect(connection(fetchImpl));
    await until(() => waits(calls).length === 1);
    const t0 = Date.now();
    await db.execute('insert into messages(id,workspace_id,author_kind,author_id,body) values (?,?,?,?,?)', ['local', ws, 'human', owner.id, 'send me']);
    await until(() => calls.some((c) => c.method === 'POST'));
    expect(Date.now() - t0).toBeLessThan(1_000);
    await until(async () => (await db.get<{ n: number }>('select count(*) n from nm_outbox')).n === 0);
    // and the loop goes back to waiting afterwards
    await until(() => waits(calls).length >= 2);
  });

  it('honours the server\'s retry hint, and never spins on a wait that comes back at once', async () => {
    const { calls, fetchImpl } = api({
      onWait: async (signal, n) => (n === 0 ? Response.json(batch([], 'c0', { wait: 25, retryMs: 300 })) : n === 1 ? Response.json(batch([], 'c0', { wait: 25 })) : hang(signal)),
    });
    const db = create();
    await db.connect(connection(fetchImpl, 200));
    await until(() => waits(calls).length === 3);
    const w = waits(calls);
    expect(w[1]!.at - w[0]!.at).toBeGreaterThanOrEqual(280);
    // an empty answer that came at once: pollMs, then a pass, then the next wait
    expect(w[2]!.at - w[1]!.at).toBeGreaterThanOrEqual(150);
  });

  it('backs off when the long-poll fails, and a 409 goes back through a pass', async () => {
    const { calls, fetchImpl } = api({
      onWait: async (signal, n) => (n === 0 ? new Response('boom', { status: 500 }) : n === 1 ? Response.json({ code: 'RESET_REQUIRED' }, { status: 409 }) : hang(signal)),
    });
    const db = create();
    const errors = console.error;
    console.error = () => {};
    try {
      await db.connect(connection(fetchImpl, 100));
      await until(() => waits(calls).length === 3);
      const w = waits(calls);
      // after the failure: a backoff of pollMs × 2, then a pass, then the next wait
      expect(w[1]!.at - w[0]!.at).toBeGreaterThanOrEqual(180);
      const afterReset = calls.slice(calls.indexOf(w[1]!) + 1, calls.indexOf(w[2]!));
      expect(afterReset.some((c) => c.url.includes('/v1/brain/replica/changes') && !c.url.includes('&wait='))).toBe(true);
    } finally { console.error = errors; }
  });

  it('a disconnect ends the wait in flight, and nothing polls after it', async () => {
    const { calls, fetchImpl } = api({});
    const db = create();
    await db.connect(connection(fetchImpl, 50));
    await until(() => waits(calls).length === 1);
    await db.disconnect();
    const after = calls.length;
    await sleep(200);
    expect(calls.length).toBe(after);
  });

  it('under an exclusiveSync lock (browser tabs) news is left for the next pass, which takes the lock', async () => {
    let locked = 0;
    const { calls, fetchImpl } = api({
      onWait: async (signal, n) => (n === 0 ? Response.json(batch([message('m2', 'news')], 'c1', { wait: 25 })) : hang(signal)),
      changes: () => batch([message('m2', 'news')], 'c1', { wait: 25 }),
    });
    const db = create();
    await db.connect({ ...connection(fetchImpl), exclusiveSync: async (work) => { locked++; return work(); } });
    await until(async () => (await db.getAll('select id from messages')).length === 1);
    await until(() => waits(calls).length === 2);
    expect(locked).toBeGreaterThanOrEqual(2);
  });
});
