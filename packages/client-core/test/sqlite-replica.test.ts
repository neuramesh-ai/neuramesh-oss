import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLegacyReplica } from '../src/replica-upgrade';
import { SQLiteReplica, type SQLiteDriver } from '../src/sqlite-replica';
import type { ReplicaBatch } from '../src/replica';

function open(filename = ':memory:') {
  const db = new DatabaseSync(filename);
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
async function owned(db: SQLiteReplica) {
  await connect(db, (async () => snapshot()) as typeof fetch);
  await db.syncNow(); await db.disconnect();
}
const replicas: SQLiteReplica[] = [];
const create = (filename?: string) => { const r = open(filename); replicas.push(r); return r; };
afterEach(async () => { for (const db of replicas.splice(0)) await db.close(); });
const batch = (changes: ReplicaBatch['changes'] = [], cursor = 'checkpoint'): ReplicaBatch => ({ schemaVersion: 1, changes, workspaces: ['workspace'], cursor, hasMore: false });
const message = { id: 'message', workspace_id: 'workspace', channel_id: 'room', author_kind: 'human', author_id: 'alice', body: 'Original', created_at: '2026-10-23' };
function connect(db: SQLiteReplica, fetchImpl: typeof fetch, id = 'alice') {
  return db.connect({ apiUrl: 'http://local.test', pollMs: 100_000, fetchImpl, identity: async () => ({ apiUrl: 'http://local.test', workspaceFallback: 'workspace', defaultActor: { kind: 'human', id } }) });
}
const snapshot = () => Response.json(batch());

describe('portable SQLite replica', () => {
  it('rolls back an invalid batch and its cursor together', async () => {
    const db = create();
    await db.applyBatch(batch([{ table: 'messages', id: message.id, row: message }]), true);
    await expect(db.applyBatch(batch([{ table: 'messages', id: message.id, row: null }, { table: 'secret_table', id: 'bad', row: {} }], 'bad'), false)).rejects.toThrow('Unknown sync table');
    expect(await db.get('select body from messages')).toEqual({ body: 'Original' });
    expect(await db.get("select value from nm_sync_meta where key='cursor'")).toEqual({ value: 'checkpoint' });
    expect(await db.getAll('select * from nm_outbox')).toEqual([]);
  });
  it('persists an offline send across a restart and acknowledges only after the API succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nm-portable-replica-'));
    let db = open(join(dir, 'test.sqlite'));
    let uploads = 0;
    try {
      await connect(db, (async () => snapshot()) as typeof fetch);
      await db.syncNow();
      await db.disconnect();
      await db.execute('insert into messages(id,workspace_id,author_kind,author_id,body) values (?,?,?,?,?)', ['message', 'workspace', 'human', 'alice', 'Offline message']);
      await db.close();
      db = open(join(dir, 'test.sqlite'));
      const network = (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') { uploads++; return new Response('unavailable', { status: 503 }); }
        return snapshot();
      }) as typeof fetch;
      await connect(db, network);
      await expect(db.syncNow()).rejects.toThrow('503');
      expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n: 1 });
      expect(await db.get('select body from messages')).toEqual({ body: 'Offline message' });
      await connect(db, (async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') { uploads++; return Response.json({ ok: true }); }
        return Response.json(batch([{ table: 'messages', id: 'message', row: { ...message, body: 'Offline message' } }]));
      }) as typeof fetch);
      await db.syncNow();
      expect(uploads).toBe(2);
      expect(await db.getAll('select * from nm_outbox')).toEqual([]);
      expect(await db.waitForRowSync('messages', 'message')).toBe(true);
    } finally { await db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('quarantines another account’s pending writes, including within the same workspace', async () => {
    const db = create();
    await connect(db, (async () => snapshot()) as typeof fetch);
    await db.syncNow();
    await db.disconnect();
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['private', 'workspace', 'Alice draft']);
    await db.disconnectAndClear();
    const posted: unknown[] = [];
    await connect(db, (async (_input: unknown, init?: RequestInit) => { if (init?.method === 'POST') posted.push(init.body); return snapshot(); }) as typeof fetch, 'bob');
    await db.syncNow();
    expect(posted).toEqual([]);
    expect(await db.getAll('select * from messages')).toEqual([]);
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n: 1 });
  });
  it('retains a newer edit while an older write is being acknowledged', async () => {
    const db = create();
    await connect(db, (async () => snapshot()) as typeof fetch);
    await db.syncNow();
    await db.disconnect();
    await db.execute('insert into whiteboards(id,workspace_id,title,rev) values (?,?,?,?)', ['board', 'workspace', 'First', 1]);
    let writes = 0;
    await connect(db, (async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') { writes++; await db.execute('update whiteboards set title=?,rev=2 where id=?', ['Second', 'board']); return Response.json({ ok: true }); }
      return Response.json(batch([{ table: 'whiteboards', id: 'board', row: { id: 'board', workspace_id: 'workspace', title: 'First', rev: 1 } }]));
    }) as typeof fetch);
    await db.syncNow();
    expect(writes).toBe(1);
    expect(await db.get('select title from whiteboards')).toEqual({ title: 'Second' });
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n: 1 });
  });
});


describe('replica lifecycle and recovery', () => {
  it('binds the account before cached reads and preserves the previous outbox', async () => {
    const db = create(); await owned(db);
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['draft','workspace','Alice only']);
    await db.activate({kind:'human',id:'bob'});
    expect(await db.getAll('select * from messages')).toEqual([]);
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({n:1});
    await db.activate({kind:'human',id:'alice'});
    await db.applyBatch(batch(), true);
    expect(await db.get('select body from messages')).toEqual({body:'Alice only'});
  });
  it('upgrades an existing Local cache without erasing its unowned outbox', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nm-local-upgrade-'));
    const filename = join(dir, 'old.sqlite');
    const old = new DatabaseSync(filename);
    old.exec('create table nm_outbox(sequence integer primary key,table_name text,row_id text,operation text,row_data text)');
    old.prepare('insert into nm_outbox values (1,?,?,?,?)').run('messages','message','PUT',JSON.stringify(message));
    old.exec('create table messages(id text primary key,body text)');
    old.prepare('insert into messages values (?,?)').run('message','Original');
    old.close();
    const db = open(filename);
    try {
      await db.activate({kind:'human',id:'alice'});
      expect(await db.get('select body from messages')).toEqual({body:'Original'});
      expect(await db.get('select owner from nm_outbox')).toEqual({owner:JSON.stringify({kind:'human',id:'alice'})});
    } finally { await db.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it('keeps a pending edit over a server tombstone until its refusal is acknowledged', async () => {
    const db = create(); await owned(db);
    const board = { workspace_id:'workspace',title:'Server',rev:1 };
    await db.applyBatch(batch([{table:'whiteboards',id:'board',row:board}]),true);
    await db.execute('update whiteboards set title=?,rev=2 where id=?',['Offline','board']);
    await db.applyBatch(batch([{table:'whiteboards',id:'board',row:null}],'deleted'),false);
    expect(await db.get('select title from whiteboards')).toEqual({title:'Offline'});
    await connect(db,(async (_input,init) => init?.method === 'PATCH' ? new Response('gone',{status:404}) : Response.json(batch([], 'deleted'))) as typeof fetch);
    await db.syncNow();
    expect(await db.getAll('select * from whiteboards')).toEqual([]);
    expect(await db.getAll('select * from nm_outbox')).toEqual([]);
  });
  it('restores the canonical board after a stale revision and a failed follow-up download', async () => {
    const db = create(); await owned(db);
    await db.applyBatch(batch([{table:'whiteboards',id:'board',row:{workspace_id:'workspace',title:'Newer server',rev:8}}]),true);
    await db.execute('update whiteboards set title=?,rev=2 where id=?',['Stale edit','board']);
    let acknowledged = false;
    await connect(db,(async (_input,init) => {
      if (init?.method === 'PATCH') { acknowledged = true; return new Response('conflict',{status:409}); }
      if (acknowledged) throw new Error('download offline');
      return snapshot();
    }) as typeof fetch);
    await expect(db.syncNow()).rejects.toThrow('download offline');
    expect(await db.get('select title,rev from whiteboards')).toEqual({title:'Newer server',rev:8});
    expect(await db.getAll('select * from nm_outbox')).toEqual([]);
  });
  it('keeps a newer local edit when an old acknowledgement precedes a download failure', async () => {
    const db = create(); await owned(db);
    await db.execute('insert into whiteboards(id,workspace_id,title,rev) values (?,?,?,1)',['board','workspace','First']);
    let acknowledged = false;
    await connect(db,(async (_input,init) => {
      if (init?.method === 'POST') {
        await db.execute('update whiteboards set title=?,rev=2 where id=?',['Second','board']);
        acknowledged = true; return Response.json({ok:true});
      }
      if (acknowledged) throw new Error('download offline');
      return snapshot();
    }) as typeof fetch);
    await expect(db.syncNow()).rejects.toThrow('download offline');
    expect(await db.get('select title from whiteboards')).toEqual({title:'Second'});
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({n:1});
  });
  it('deduplicates query watches and stops delivery on abort', async () => {
    const db = create(); await owned(db);
    const abort = new AbortController(), states: unknown[] = [];
    db.watch('select body from messages', [], { onResult: value => states.push(value.rows?._array) }, { signal: abort.signal });
    await expect.poll(() => states.length).toBe(1);
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['local','workspace','first']);
    await expect.poll(() => states.length).toBe(2);
    await db.execute('update messages set body=body');
    await db.getAll('select * from messages');
    abort.abort();
    await db.execute('update messages set body=?', ['hidden']);
    await db.getAll('select * from messages');
    expect(states).toEqual([[], [{ body: 'first' }]]);
  });
  it('purges revoked workspace data while preserving quarantined offline writes', async () => {
    const db = create(); await owned(db);
    await db.applyBatch(batch([{ table: 'messages', id: 'remote', row: message }]), true);
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['pending','workspace','private']);
    await db.applyBatch({ ...batch([], 'revoked'), workspaces: [] }, true);
    expect(await db.getAll('select * from messages')).toEqual([]);
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n: 1 });
  });
  it('retries a lost acknowledgement with the same message id', async () => {
    const db = create(); await owned(db);
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['message','workspace','one effect']);
    const server = new Map<string, Record<string, unknown>>(); let attempts = 0;
    await connect(db, (async (_input, init) => {
      if (init?.method === 'POST') {
        const value = JSON.parse(String(init.body)); server.set(value.id, { ...message, body: value.body });
        if (++attempts === 1) throw new Error('acknowledgement lost');
        return Response.json({ id: value.id });
      }
      return Response.json(batch([...server].map(([id,row]) => ({ table:'messages', id, row }))));
    }) as typeof fetch);
    await expect(db.syncNow()).rejects.toThrow('acknowledgement lost');
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n: 1 });
    await db.syncNow();
    expect(server.size).toBe(1); expect(attempts).toBe(2);
    expect(await db.getAll('select * from nm_outbox')).toEqual([]);
  });
  it('does not dispatch an optimistic message before its server-created thread arrives', async () => {
    const db = create(); await owned(db);
    await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['message','workspace','ask']);
    let uploaded = false, ready = false;
    const confirmed = db.waitForRowSync('messages','message').then(value => { ready = value; return value; });
    await connect(db, (async (_input, init) => {
      if (init?.method === 'POST') { uploaded = true; return Response.json({ ok: true }); }
      if (uploaded) { expect(ready).toBe(false); return Response.json(batch([
        { table:'messages', id:'message', row:message },
        { table:'threads', id:'thread', row:{ workspace_id:'workspace',title:'ask' } },
      ])); }
      return snapshot();
    }) as typeof fetch);
    await db.syncNow(); expect(await confirmed).toBe(true);
    expect(await db.get('select id from threads')).toEqual({ id:'thread' });
  });
  it('refreshes an expired upload credential without dropping a whiteboard', async () => {
    const db = create(); await owned(db);
    await db.execute('insert into whiteboards(id,workspace_id,title,rev) values (?,?,?,?)',['board','workspace','save me',1]);
    const refresh: boolean[] = []; let writes = 0;
    await db.connect({ apiUrl:'http://local.test',pollMs:100000,
      identity: async force => { refresh.push(!!force); return { apiUrl:'http://local.test',workspaceFallback:'workspace',defaultActor:{kind:'human',id:'alice'} }; },
      fetchImpl: (async (_input,init) => init?.method === 'POST' && ++writes === 1 ? new Response('expired',{status:401}) : snapshot()) as typeof fetch,
    });
    await expect(db.syncNow()).rejects.toThrow('401');
    expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n:1 });
    await db.syncNow(); expect(refresh).toEqual([false,true]);
    expect(await db.getAll('select * from nm_outbox')).toEqual([]);
  });
  it('closes pending readiness and row waiters instead of leaving dispatch hanging', async () => {
    const db = open(); await db.waitForReady();
    const first = expect(db.waitForFirstSync()).rejects.toThrow('closed');
    const row = db.waitForRowSync('messages','absent');
    await db.close(); await first; expect(await row).toBe(false);
  });
  it('imports legacy rows and queued edits atomically, once, without changing the source', async () => {
    const legacy = new DatabaseSync(':memory:');
    legacy.exec('create table ps_data__messages(id text,data text); create table ps_crud(id integer,data text)');
    legacy.prepare('insert into ps_data__messages values (?,?)').run('message',JSON.stringify(message));
    legacy.prepare('insert into ps_crud values (?,?)').run(1,JSON.stringify({ op:'PUT',type:'messages',id:'message',data:message }));
    const source: SQLiteDriver = { async query(sql) { return { rows:legacy.prepare(sql).all() }; },async close() {} };
    try {
      const snapshot = await readLegacyReplica(source), db = create(), owner = { kind:'human',id:'alice' };
      await db.importLegacy(snapshot,owner,'old');
      await db.importLegacy(snapshot,owner,'old');
      expect(await db.get('select body from messages')).toEqual({ body:'Original' });
      expect(await db.get('select count(*) n from nm_outbox')).toEqual({ n:1 });
      expect(legacy.prepare('select count(*) n from ps_crud').get()).toEqual({ n:1 });
      legacy.prepare('insert into ps_crud values (?,?)').run(2,JSON.stringify({op:'DELETE',type:'unknown',id:'bad'}));
      await expect(readLegacyReplica(source)).rejects.toThrow('unsupported legacy write');
      const failed = create();
      await expect(failed.importLegacy({ rows:[...snapshot.rows,{table:'secret',id:'bad',row:{}}],pending:snapshot.pending },owner,'old')).rejects.toThrow();
      expect(await failed.getAll('select * from messages')).toEqual([]);
      expect(await failed.getAll("select * from nm_sync_meta where key='import:old'")).toEqual([]);
    } finally { legacy.close(); }
  });
});


describe('rejected upload recovery', () => {
  it('archives a permanent refusal and sends the next message without losing the rejected text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nm-refused-send-'));
    const filename = join(dir, 'replica.sqlite');
    let db = open(filename);
    try {
      await owned(db);
      await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['refused','workspace','Keep this draft']);
      await db.execute('insert into messages(id,workspace_id,body) values (?,?,?)', ['next','workspace','Send this next']);
      const notices: string[] = [], sent: string[] = [];
      await db.connect({ apiUrl: 'http://local.test', pollMs: 100_000,
        identity: async () => ({ apiUrl: 'http://local.test', workspaceFallback: 'workspace', defaultActor: {kind:'human',id:'alice'} }),
        onUploadRejected: (reason, row) => notices.push(`${reason}: ${row['body']}`),
        fetchImpl: (async (_url: unknown, init?: RequestInit) => {
          if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body)); sent.push(body.id);
            return body.id === 'refused' ? Response.json({error:'Thread is unavailable'}, {status:403}) : Response.json({ok:true});
          }
          return Response.json(batch(sent.includes('next') ? [{table:'messages',id:'next',row:{...message,id:'next',body:'Send this next'}}] : []));
        }) as typeof fetch,
      });
      await db.syncNow(); await db.disconnect();
      expect(sent).toEqual(['refused','next']);
      expect(notices).toEqual(['Thread is unavailable: Keep this draft']);
      expect(await db.waitForRowSync('messages','refused')).toBe(false);
      expect(await db.getAll('select * from nm_outbox')).toEqual([]);
      expect(await db.getAll('select id from messages')).toEqual([{id:'next'}]);
      await db.close(); db = open(filename);
      const failed = await db.get<{row_data:string;owner:string}>('select row_data,owner from nm_failed_uploads');
      expect(JSON.parse(failed.row_data).body).toBe('Keep this draft');
      expect(JSON.parse(failed.owner)).toEqual({kind:'human',id:'alice'});
    } finally { await db.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it('publishes a sync failure and clears it only after recovery', async () => {
    const db = create();
    await connect(db, (async () => new Response('offline',{status:503})) as typeof fetch);
    await expect(db.syncNow()).rejects.toThrow('503');
    expect(db.currentStatus).toMatchObject({connected:false,error:'Sync failed (503)'});
    await connect(db, (async () => snapshot()) as typeof fetch); await db.syncNow();
    expect(db.currentStatus.connected).toBe(true);
    expect(db.currentStatus.error).toBeUndefined();
  });
});
