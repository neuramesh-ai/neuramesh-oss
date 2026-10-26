import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { decodeLocalCursor, localBootstrap, localChanges, localReplicaRow } from '../src/local-sync';
import { hashLocalToken } from '../src/local-auth';
import { mintMachineToken } from '../src/machine-auth';
import type { Actor } from '@neuramesh/shared';
import { SQLiteReplica } from '@neuramesh/client-core/sqlite-replica';
import { sqliteDriver } from '../../../apps/desktop/src/main/sync/sqlite-driver';
const replica = (file: string) => new SQLiteReplica(sqliteDriver(file, { nodeSqlite: true }));

// Opt-in to a throwaway database. Never run these destructive authorization/retention scenarios
// against an ordinary DATABASE_URL or the user's running workspace.
const url = process.env['NM_LOCAL_SYNC_TEST_DB_URL'];
const store = url ? new PostgresStore(url) : null;
const ws = 'a0000000-0000-0000-0000-00000000000a';
const bearer = `nmh_${'c'.repeat(48)}`;
let actor: Actor;
const oldLocal = process.env['NM_LOCAL'];
const oldHeaders = process.env['NM_ALLOW_ACTOR_HEADER'];
beforeAll(async () => {
  if (!store) return;
  process.env['NM_LOCAL'] = '1';
  process.env['NM_ALLOW_ACTOR_HEADER'] = '0';
  const user = await store.seedLocalUser({ clerkUserId: 'local-sync-test', email: 'local-sync@test.invalid', tokenHash: hashLocalToken(bearer) });
  actor = { kind: 'human', id: user.id };
  await store.sql`insert into workspace_members(workspace_id,user_id,role) values (${ws},${actor.id},'owner') on conflict do nothing`;
});
afterAll(async () => {
  if (oldLocal === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = oldLocal;
  if (oldHeaders === undefined) delete process.env['NM_ALLOW_ACTOR_HEADER']; else process.env['NM_ALLOW_ACTOR_HEADER'] = oldHeaders;
  await store?.close();
});

// Docker-backed snapshots scan every replicated table; allow for a busy development machine.
describe.skipIf(!url)('local replica protocol on real Postgres', { timeout: 30_000 }, () => {
  it('waits for a pre-enrollment writer before its first snapshot', async () => {
    const sql = store!.sql;
    await sql`update local_sync_state set enabled=false where singleton`;
    const [channel] = await sql<{ id: string }[]>`select id from channels where workspace_id=${ws} limit 1`;
    const marker = `before enrollment ${randomUUID()}`;
    let written!: () => void;
    let release!: () => void;
    const wrote = new Promise<void>((r) => { written = r; });
    const hold = new Promise<void>((r) => { release = r; });
    const writer = sql.begin(async (tx) => { await tx`update channels set topic=${marker} where id=${channel!.id}`; written(); await hold; });
    await wrote;
    let finished = false;
    const snapshot = localBootstrap(sql, actor).then((value) => { finished = true; return value; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(finished).toBe(false);
    } finally { release(); }
    const [, boot] = await Promise.all([writer, snapshot]);
    expect(boot.changes.find((c) => c.table === 'channels' && c.id === channel!.id)?.row?.['topic']).toBe(marker);
  });

  it('requires the verified local bearer, blocks actor forgery, and returns only contract columns', async () => {
    const app = createApp(store!);
    expect((await app.request('/v1/sync/bootstrap')).status).toBe(401);
    expect((await app.request('/v1/sync/bootstrap', { headers: { 'x-nm-actor': JSON.stringify(actor) } })).status).toBe(401);
    const response = await app.request('/v1/sync/bootstrap', { headers: { authorization: `Bearer ${bearer}` } });
    expect(response.status).toBe(200);
    const data = await response.json() as { workspaces: string[]; changes: unknown[] };
    expect(data.workspaces).toContain(ws);
    expect(data.changes.length).toBeGreaterThan(0);
    expect(localReplicaRow('machines', { id: 'id', token_hash: 'secret' })).not.toHaveProperty('token_hash');
    expect(localReplicaRow('messages', { id: 'id', pinned: true, body: 'text' })).toMatchObject({ id: 'id', pinned: 1, body: 'text' });
  });

  it('limits machine snapshots to their workspace and revokes cursors with the token or membership', async () => {
    const sql = store!.sql, app = createApp(store!);
    const foreign = randomUUID(), { token, hash } = mintMachineToken();
    await sql`insert into workspaces(id,name,slug,created_by) values (${foreign},'Private sibling',${`replica-${foreign}`},${actor.id})`;
    await sql`insert into workspace_members(workspace_id,user_id,role) values (${foreign},${actor.id},'owner')`;
    const [machine] = await sql`insert into machines(workspace_id,owner_user_id,name,kind,token_hash)
      values (${ws},${actor.id},${`replica-${randomUUID()}`},'member',${hash}) returning id`;
    const headers = { authorization:`Bearer ${token}` };
    try {
      const human = await localBootstrap(sql, actor);
      expect(human.workspaces).toContain(foreign);
      const response = await app.request('/v1/brain/replica/bootstrap', { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const snapshot = await response.json() as { workspaces:string[];cursor:string;changes:Array<{row:Record<string,unknown>|null}> };
      expect(snapshot.workspaces).toEqual([ws]);
      expect(snapshot.changes.some(c => c.row?.['workspace_id'] === foreign)).toBe(false);
      expect((await app.request('/v1/brain/replica/bootstrap', { headers:{ ...headers,'x-nm-actor':JSON.stringify({kind:'human',id:randomUUID()}) } })).status).toBe(401);
      await sql`delete from workspace_members where workspace_id=${ws} and user_id=${actor.id}`;
      const changed = await app.request(`/v1/brain/replica/changes?cursor=${encodeURIComponent(snapshot.cursor)}`, { headers });
      expect(changed.status).toBe(409);
      const revoked = await app.request('/v1/brain/replica/bootstrap', { headers });
      expect((await revoked.json() as {workspaces:string[]}).workspaces).toEqual([]);
      await sql`update machines set token_hash=null where id=${machine!['id']}`;
      expect((await app.request('/v1/brain/replica/bootstrap',{headers})).status).toBe(401);
    } finally {
      await sql`insert into workspace_members(workspace_id,user_id,role) values (${ws},${actor.id},'owner') on conflict do nothing`;
      await sql`delete from machines where id=${machine!['id']}`;
      await sql`delete from workspace_members where workspace_id=${foreign}`;
      await sql`delete from workspaces where id=${foreign}`;
    }
  });

  it('streams project team additions and removals after the initial snapshot', async () => {
    const sql = store!.sql;
    const [project] = await sql`select id from projects where workspace_id = ${ws}::uuid limit 1`;
    const [agent] = await sql`insert into agents(workspace_id, name, role, runtime, model)
      values (${ws}::uuid, ${`replica-${randomUUID().slice(0,8)}`}, 'worker', 'claude-code', 'test') returning id`;
    const before = await localBootstrap(sql, actor);
    const [member] = await sql`insert into project_agents(workspace_id, project_id, agent_id)
      values (${ws}::uuid, ${project!['id']}::uuid, ${agent!['id']}::uuid) returning id`;
    const added = await localChanges(sql, actor, decodeLocalCursor(before.cursor)!);
    expect(added!.changes.find(c => c.table === 'project_agents' && c.id === member!['id'])?.row?.['project_id']).toBe(project!['id']);
    await sql`delete from project_agents where id = ${member!['id']}::uuid`;
    const removed = await localChanges(sql, actor, decodeLocalCursor(added!.cursor)!);
    expect(removed!.changes.find(c => c.table === 'project_agents' && c.id === member!['id'])?.row).toBeNull();
  });

  it('binds a repeatable snapshot to its cursor and never skips an uncommitted earlier revision', async () => {
    const sql = store!.sql;
    const initial = await localBootstrap(sql, actor);
    const channels = await sql<{ id: string }[]>`select id from channels where workspace_id=${ws} order by id limit 2`;
    let written!: () => void;
    let release!: () => void;
    const markerA = `commit A ${randomUUID()}`;
    const markerB = `commit B ${randomUUID()}`;
    const wrote = new Promise<void>((r) => { written = r; });
    const hold = new Promise<void>((r) => { release = r; });
    const first = sql.begin(async (tx) => { await tx`update channels set topic=${markerA} where id=${channels[0]!.id}`; written(); await hold; });
    await wrote;
    let secondCommitted = false;
    const second = sql.begin(async (tx) => { await tx`update channels set topic=${markerB} where id=${channels[1]!.id}`; }).then(() => { secondCommitted = true; });
    const during = await localBootstrap(sql, actor).finally(() => release());
    const prematureCommit = secondCommitted;
    await Promise.all([first, second]);
    expect(decodeLocalCursor(during.cursor)?.revision).toBe(decodeLocalCursor(initial.cursor)?.revision);
    expect(during.changes.find((c) => c.table === 'channels' && c.id === channels[0]!.id)?.row?.['topic']).not.toBe(markerA);
    expect(prematureCommit).toBe(false);
    const delta = await localChanges(sql, actor, decodeLocalCursor(during.cursor)!);
    expect(delta!.changes.filter((c) => c.table === 'channels').map((c) => c.row?.['topic'])).toEqual([markerA, markerB]);
  });

  it('keeps a transaction intact even with a one-row page and records real tombstones', async () => {
    const sql = store!.sql;
    const before = await localBootstrap(sql, actor);
    const id = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into channels(id,workspace_id,project_id,slug,topic) select ${id},workspace_id,project_id,${`sync-${id}`},'one' from channels where workspace_id=${ws} limit 1`;
      await tx`insert into channel_members(channel_id,user_id) values (${id},${actor.id})`;
      await tx`update channels set topic='two' where id=${id}`;
    });
    const changes = await localChanges(sql, actor, decodeLocalCursor(before.cursor)!, 1);
    expect(changes!.changes.filter((c) => c.id === id)).toHaveLength(2);
    const roster = changes!.changes.find((c) => c.table === 'channel_members')!;
    expect(roster).toBeTruthy();
    await sql`delete from channels where id=${id}`;
    const deleted = await localChanges(sql, actor, decodeLocalCursor(changes!.cursor)!);
    expect(deleted!.changes).toContainEqual({ table: 'channels', id, row: null });
    expect(deleted!.changes).toContainEqual({ table: 'channel_members', id: roster.id, row: null });
  });

  it('does not publish phantom changes from INSERT ON CONFLICT DO NOTHING', async () => {
    const sql = store!.sql;
    const before = await localBootstrap(sql, actor);
    await sql`insert into workspace_members(workspace_id,user_id,role) values (${ws},${actor.id},'owner') on conflict do nothing`;
    const delta = await localChanges(sql, actor, decodeLocalCursor(before.cursor)!);
    expect(delta!.changes).toEqual([]);
  });

  it('syncs two real SQLite device replicas through authenticated API routes and recovers an offline restart', async () => {
    const app = createApp(store!);
    let offline = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (offline) throw new Error('device offline');
      return app.request(String(input), init);
    }) as typeof fetch;
    const config = { apiUrl: 'http://local.test', pollMs: 100_000, fetchImpl, identity: async () => ({
      apiUrl: 'http://local.test', workspaceFallback: ws, defaultActor: { kind: 'human', id: actor.id }, authHeaders: { authorization: `Bearer ${bearer}` },
    }) };
    const directory = mkdtempSync(join(tmpdir(), 'nm-two-replicas-'));
    let first = replica(join(directory, 'first.sqlite'));
    const second = replica(join(directory, 'second.sqlite'));
    try {
      await first.connect(config);
      await second.connect(config);
      await Promise.all([first.syncNow(), second.syncNow()]);
      const [channel] = await store!.sql<{ id: string }[]>`select id from channels where workspace_id=${ws} order by id limit 1`;
      const thread = randomUUID();
      const id = randomUUID();
      offline = true;
      await first.execute(`insert into messages(id,workspace_id,channel_id,thread_id,author_kind,author_id,body,created_at)
        values(?,?,?,?,'human',?,?,?)`, [id, ws, channel!.id, thread, actor.id, 'Retain this across a device restart.', new Date().toISOString()]);
      await expect(first.syncNow()).rejects.toThrow('device offline');
      await first.close();
      first = replica(join(directory, 'first.sqlite'));
      offline = false;
      await first.connect(config);
      await first.syncNow();
      await second.syncNow();
      expect(await second.get('select id,thread_id,body from messages where id=?', [id])).toEqual({ id, thread_id: thread, body: 'Retain this across a device restart.' });
      expect(await second.get('select id from threads where id=?', [thread])).toEqual({ id: thread });
      expect(await first.get('select count(*) n from nm_outbox')).toEqual({ n: 0 });
      await store!.sql`delete from messages where id=${id}`;
      await second.syncNow();
      expect(await second.getAll('select id from messages where id=?', [id])).toEqual([]);
    } finally {
      await first.close();
      await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resets an expired cursor and a revoked membership instead of exposing stale scope', async () => {
    const sql = store!.sql;
    const before = await localBootstrap(sql, actor);
    const cursor = decodeLocalCursor(before.cursor)!;
    await sql`update local_sync_state set retained_after=revision where singleton`;
    expect(await localChanges(sql, actor, { ...cursor, revision: '0' })).toBeNull();
    await sql`delete from workspace_members where workspace_id=${ws} and user_id=${actor.id}`;
    expect(await localChanges(sql, actor, cursor)).toBeNull();
    const reset = await localBootstrap(sql, actor);
    expect(reset.workspaces).toEqual([]);
    expect(reset.changes).toEqual([]);
    await sql`insert into workspace_members(workspace_id,user_id,role) values (${ws},${actor.id},'owner')`;
    expect(await localChanges(sql, actor, cursor)).toBeNull();
  });
});
