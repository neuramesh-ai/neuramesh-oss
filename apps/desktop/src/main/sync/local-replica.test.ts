import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalReplica, type LocalSyncConnection } from './local-replica';
import { pendingPowerSyncWrites } from './local-replica';
import Database from 'better-sqlite3';
import type { ReplicaBatch } from '@neuramesh/client-core/replica';

const ws = '00000000-0000-0000-0000-000000000001';
const message = (id: string, body: string) => ({ table: 'messages', id, row: { workspace_id: ws, body } });
const batch = (changes: ReplicaBatch['changes'] = [], cursor = 'one', workspaces = [ws]): ReplicaBatch => ({ schemaVersion: 1, changes, cursor, workspaces, hasMore: false });
const put = (db: LocalReplica, id: string, body: string) => db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', [id, ws, body]);
const count = async (db: LocalReplica) => (await db.get<{ n: number }>('select count(*) n from ps_crud')).n;
const connection = (fetchImpl: typeof fetch): LocalSyncConnection => ({ apiUrl: 'http://test.local', pollMs: 100_000,
  identity: async () => ({ apiUrl: 'http://test.local', workspaceFallback: ws, defaultActor: { kind: 'human', id: ws }, authHeaders: { authorization: 'Bearer test' } }), fetchImpl });

test('an offline message and its outbox survive process restart and a fresh bootstrap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-replica-'));
  try {
    const file = join(dir, 'replica.sqlite');
    let db = new LocalReplica(file);
    await put(db, 'offline', 'keep this');
    assert.equal(await count(db), 1);
    await db.close();
    db = new LocalReplica(file);
    db.applyBatch(batch([message('remote', 'other device')]), true);
    assert.deepEqual((await db.getAll<{ body: string }>('select body from messages order by id')).map((r) => r.body), ['keep this', 'other device']);
    assert.equal(await count(db), 1);
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('watches emit their initial rows, deduplicate unchanged results, and stop on abort', async () => {
  const db = new LocalReplica(':memory:');
  const ac = new AbortController();
  const states: unknown[] = [];
  db.watch('select body from messages order by id', [], { onResult: (r) => states.push(r.rows?._array) }, { signal: ac.signal });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await put(db, 'local', 'first');
  await db.execute('update messages set body=body where id=?', ['local']);
  ac.abort();
  await put(db, 'second', 'hidden');
  assert.deepEqual(states, [[], [{ body: 'first' }]]);
  await db.close();
});

test('a malformed batch rolls back rows and its cursor together', async () => {
  const db = new LocalReplica(':memory:');
  db.applyBatch(batch([message('original', 'safe')]), true);
  assert.throws(() => db.applyBatch(batch([message('new', 'bad batch'), { table: 'secret_table', id: 'bad', row: {} }], 'two'), false), /Unknown local sync/);
  assert.deepEqual(await db.getAll('select id from messages'), [{ id: 'original' }]);
  assert.equal((await db.get<{ value: string }>("select value from nm_sync_meta where key='cursor'")).value, 'one');
  await db.close();
});

test('membership reset purges cached data and quarantines the offline outbox', async () => {
  const db = new LocalReplica(':memory:');
  db.applyBatch(batch([message('remote', 'private')]), true);
  await put(db, 'pending', 'private offline');
  db.applyBatch(batch([], 'revoked', []), true);
  assert.deepEqual(await db.getAll('select * from messages'), []);
  assert.equal(await count(db), 1, 'the durable outbox is retained for explicit recovery');
  await db.close();
});

test('network loss after the server accepts a message retries the same id without data loss', async () => {
  const db = new LocalReplica(':memory:');
  const server = new Map<string, string>();
  let loseAcknowledgement = true;
  let uploads = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init!.headers as Record<string, string>)['authorization'], 'Bearer test');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { id: string; body: string };
      uploads++;
      server.set(body.id, body.body);
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('connection lost after commit'); }
      return Response.json({ id: body.id });
    }
    return Response.json(batch([...server].map(([id, body]) => message(id, body))));
  }) as typeof fetch;
  await put(db, 'retry-me', 'one effect');
  await db.connect(connection(fetchImpl));
  await assert.rejects(db.syncNow(), /connection lost/);
  assert.equal(await count(db), 1);
  await db.syncNow();
  assert.equal(await count(db), 0);
  assert.equal(server.size, 1);
  assert.equal(uploads, 2);
  assert.equal((await db.get<{ body: string }>('select body from messages')).body, 'one effect');
  assert.equal(db.currentStatus.connected, true);
  await db.close();
});

test('a tombstone removes a row, while a newer offline edit survives a server echo', async () => {
  const db = new LocalReplica(':memory:');
  db.applyBatch(batch([message('gone', 'delete'), message('same', 'old')]), true);
  await db.execute('update messages set body=? where id=?', ['new local text', 'same']);
  db.applyBatch(batch([{ table: 'messages', id: 'gone', row: null }, message('same', 'remote echo')], 'two'), false);
  assert.deepEqual(await db.getAll('select id,body from messages'), [{ id: 'same', body: 'new local text' }]);
  assert.equal(await count(db), 1);
  await db.close();
});

test('a stale whiteboard acknowledgement restores the canonical server revision', async () => {
  const db = new LocalReplica(':memory:');
  const board = { table: 'whiteboards', id: 'board', row: { workspace_id: ws, rev: 5, title: 'remote title' } };
  db.applyBatch(batch([board]), true);
  await db.execute('update whiteboards set rev=4,title=? where id=?', ['stale local title', 'board']);
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => init?.method === 'PATCH'
    ? Response.json({ applied: false }) : Response.json(batch([board]))) as typeof fetch;
  await db.connect(connection(fetchImpl));
  await db.syncNow();
  assert.equal(await count(db), 0);
  assert.deepEqual(await db.get('select title,rev from whiteboards'), { title: 'remote title', rev: 5 });
  await db.close();
});

test('legacy migration preserves the source queue and imports only its public read views', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nm-legacy-cache-'));
  const filename = join(directory, 'old.sqlite');
  const legacy = new Database(filename);
  legacy.exec(`create table ps_data__messages(id text primary key, data text);
    create view messages as select id,json_extract(data,'$.body') as body,json_extract(data,'$.workspace_id') as workspace_id from ps_data__messages;
    create table ps_crud(id integer primary key,data text);
    insert into ps_crud values(1,'pending queue');`);
  legacy.prepare('insert into ps_data__messages values (?,?)').run('old-message', JSON.stringify({ body: 'cached offline', workspace_id: ws }));
  const db = new LocalReplica(join(directory, 'new.sqlite'));
  try {
    db.adoptPowerSyncCache(filename);
    assert.deepEqual(await db.get('select id,body from messages'), { id: 'old-message', body: 'cached offline' });
    assert.equal(await count(db), 0, 'the new outbox does not copy SDK queue internals');
    assert.equal(pendingPowerSyncWrites(filename), 1, 'the original HTTP uploader owns this pending write');
    db.applyBatch(batch([message('new-message', 'authoritative')]), true);
    db.adoptPowerSyncCache(filename);
    assert.deepEqual(await db.getAll('select id from messages'), [{ id: 'new-message' }], 'a later launch cannot restore stale cache over current rows');
  } finally { await db.close(); legacy.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an edit made during upload stays visible when the following download fails', async () => {
  const db = new LocalReplica(':memory:');
  const board = { table: 'whiteboards', id: 'board', row: { workspace_id: ws, rev: 5, title: 'server title' } };
  db.applyBatch(batch([board]), true);
  await db.execute('update whiteboards set rev=6,title=? where id=?', ['first edit', 'board']);
  let downloadCount = 0;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      await db.execute('update whiteboards set rev=7,title=? where id=?', ['newer edit', 'board']);
      return Response.json({ applied: true });
    }
    if (downloadCount++) throw new Error('download interrupted');
    return Response.json(batch([board]));
  }) as typeof fetch;
  await db.connect(connection(fetchImpl));
  try {
    await assert.rejects(db.syncNow(), /download interrupted/);
    assert.equal(await count(db), 1);
    assert.deepEqual(await db.get('select title,rev from whiteboards'), { title: 'newer edit', rev: 7 });
  } finally { await db.close(); }
});

test('host dispatch waits for a message and its server-created thread to be synchronized', async () => {
  const db = new LocalReplica(':memory:');
  await put(db, 'new-message', 'ask the agent');
  let ready = false;
  const committed = db.waitForRowSync('messages', 'new-message').then((value) => { ready = value; return value; });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(ready, false, 'optimistic UI writes must not start a server run');
  let uploaded = false;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') { uploaded = true; return Response.json({ id: 'new-message' }); }
    return Response.json(batch(uploaded ? [message('new-message', 'ask the agent'), {
      table: 'threads', id: 'born-thread', row: { workspace_id: ws, title: 'ask the agent' },
    }] : []));
  }) as typeof fetch;
  await db.connect(connection(fetchImpl));
  await db.syncNow();
  assert.equal(await committed, true);
  assert.equal((await db.get<{ id: string }>('select id from threads')).id, 'born-thread');
  await db.close();
});
