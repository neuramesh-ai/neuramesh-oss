// THE FEED AT SCALE on the real schema (migration 0159, local-sync.ts, design §10.2, gate A1):
// per-workspace revisions taken at COMMIT, so writers in different workspaces never wait for each
// other; a version 1 cursor resets; membership and retention reset; the prune works per workspace;
// heavy columns stay out of the log; and a long-poll is answered within a second of a write.
// Run by the pg lane (DATABASE_URL). A fresh user and fresh workspaces, so other suites are untouched.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { decodeLocalCursor, localBootstrap, localChanges, pruneLocalChanges, readChanges, syncWakeFor } from '../src/local-sync';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
// a second client, so that test transactions run side by side with the store's own
const sql = DB ? postgres(DB, { max: 6, onnotice: () => {} }) : null;
const tag = `scale-${Date.now().toString(36)}`;
const FIXTURE_CHANNEL = 'c0000000-0000-0000-0000-00000000000b'; // a workspace the test user is not in
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const saved: Record<string, string | undefined> = {};
let actor: Actor;
let A = '', B = '', chA = '', chA2 = '', chB = '', chB2 = '';
let wasEnabled = false;

const asActor = () => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const cursorOf = (raw: string) => decodeLocalCursor(raw)!;
const topic = (id: string, value: string) => sql!`update channels set topic = ${value} where id = ${id}::uuid`;
/** a gate a test opens: `wait` resolves after `open()` */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => { open = r; });
  return { wait, open };
}
const head = async (ws: string) => (await sql!<{ revision: string; retained_after: string }[]>`
  select revision::text, retained_after::text from sync_heads where workspace_id = ${ws}::uuid`)[0];

beforeAll(async () => {
  if (!store || !sql || !app) return;
  for (const k of ['NM_LOCAL_SYNC', 'NM_ALLOW_ACTOR_HEADER', 'NM_SYNC_MAX_WAIT_S', 'NM_LOCAL']) saved[k] = process.env[k];
  process.env['NM_LOCAL_SYNC'] = '1';
  process.env['NM_ALLOW_ACTOR_HEADER'] = '1';
  delete process.env['NM_SYNC_MAX_WAIT_S'];
  delete process.env['NM_LOCAL'];
  wasEnabled = (await sql<{ enabled: boolean }[]>`select enabled from local_sync_state where singleton`)[0]?.enabled ?? false;
  const user = await store.resolveClerkUser(`e2e|${tag}@test.invalid`, `${tag}@test.invalid`);
  actor = { kind: 'human', id: user.id };
  const make = async (slug: string) => (await (await app.request('/v1/commands', {
    method: 'POST', headers: asActor(), body: JSON.stringify({ type: 'workspace.create', name: slug, slug }),
  })).json()) as { workspaceId: string; channelId: string };
  ({ workspaceId: A, channelId: chA } = await make(`${tag}-a`));
  ({ workspaceId: B, channelId: chB } = await make(`${tag}-b`));
  const second = async (channel: string, slug: string) => (await sql<{ id: string }[]>`
    insert into channels (id, workspace_id, project_id, slug, topic)
    select gen_random_uuid(), workspace_id, project_id, ${slug}, 'two' from channels where id = ${channel}::uuid returning id`)[0]!.id;
  chA2 = await second(chA, `${tag}-a2`);
  chB2 = await second(chB, `${tag}-b2`);
  await localBootstrap(store.sql, actor); // turns the feed on
  // one change in each workspace, so both heads exist
  await topic(chA, 'start');
  await topic(chB, 'start');
});

afterAll(async () => {
  if (sql && !wasEnabled) await sql`update local_sync_state set enabled = false where singleton`.catch(() => {});
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('the feed at scale on postgres (0159)', { timeout: 30_000 }, () => {
  it('numbers each workspace on its own, and a cursor carries one revision per workspace', async () => {
    const a0 = BigInt((await head(A))!.revision);
    const b0 = BigInt((await head(B))!.revision);
    await topic(chA, 'a-one');
    await topic(chA, 'a-two');
    expect(BigInt((await head(A))!.revision)).toBe(a0 + 2n);
    expect(BigInt((await head(B))!.revision)).toBe(b0);
    const boot = await localBootstrap(store!.sql, actor);
    expect(boot.workspaces).toEqual([A, B].sort());
    const c = cursorOf(boot.cursor);
    expect(c.v).toBe(2);
    expect(c.revisions).toEqual(boot.workspaces.map((w) => (w === A ? String(a0 + 2n) : String(b0))));
    expect(boot.wait).toBe(25);
  });

  it('two workspaces commit at the same time: a commit holds only its own workspace', async () => {
    // a writer of A inside its commit holds A's head (what record_sync_change takes at COMMIT)
    const locked = gate();
    const release = gate();
    const holder = sql!.begin(async (tx) => {
      await tx`select 1 from sync_heads where workspace_id = ${A}::uuid for update`;
      locked.open();
      await release.wait;
    });
    await locked.wait;
    try {
      const t0 = Date.now();
      await topic(chB, `b-while-a-commits ${tag}`);
      expect(Date.now() - t0).toBeLessThan(2_000);
      // A's own writers still queue behind A's commit: the order inside a workspace holds
      let aDone = false;
      const a = topic(chA, `a-after ${tag}`).then(() => { aDone = true; });
      await sleep(400);
      expect(aDone).toBe(false);
      release.open();
      await holder;
      await a;
      expect(aDone).toBe(true);
    } finally {
      release.open();
      await holder.catch(() => {});
    }
  });

  it('holds no feed lock before COMMIT: a second writer of the same workspace commits past an open one', async () => {
    const before = await localBootstrap(store!.sql, actor);
    const wrote = gate();
    const release = gate();
    const first = sql!.begin(async (tx) => {
      await tx`update channels set topic = ${'open writer'} where id = ${chA}::uuid`;
      wrote.open();
      await release.wait;
    });
    await wrote.wait;
    const t0 = Date.now();
    await topic(chA2, 'quick writer');
    const quick = Date.now() - t0;
    release.open();
    await first;
    expect(quick).toBeLessThan(2_000);
    // both land, in commit order: the quick one first
    const delta = await localChanges(store!.sql, actor, cursorOf(before.cursor));
    expect(delta!.changes.filter((c) => c.table === 'channels').map((c) => c.row?.['topic'])).toEqual(['quick writer', 'open writer']);
  });

  it('never splits a transaction inside a workspace, even with a one-row page, and pages on in commit order', async () => {
    const before = await localBootstrap(store!.sql, actor);
    await sql!.begin(async (tx) => {
      await tx`update channels set topic = 'x1' where id = ${chA}::uuid`;
      await tx`update channels set topic = 'x2' where id = ${chA2}::uuid`;
      await tx`update channels set topic = 'y1' where id = ${chB}::uuid`;
    });
    const one = await readChanges(store!.sql, actor, cursorOf(before.cursor), 1);
    expect(one!.batch.changes.map((c) => c.row?.['topic'])).toEqual(['x1', 'x2']);
    expect(one!.batch.hasMore).toBe(true);
    const two = await readChanges(store!.sql, actor, cursorOf(one!.batch.cursor), 1);
    expect(two!.batch.changes.map((c) => c.row?.['topic'])).toEqual(['y1']);
    expect(two!.batch.hasMore).toBe(false);
    const idle = await readChanges(store!.sql, actor, cursorOf(two!.batch.cursor));
    expect(idle!.advanced).toBe(false);
    expect(idle!.batch.cursor).toBe(two!.batch.cursor);
  });

  it('a transaction that writes two workspaces in opposite orders does not deadlock with another', async () => {
    const step = gate();
    const t1 = sql!.begin(async (tx) => {
      await tx`update channels set topic = 'ab-1' where id = ${chA}::uuid`;
      await step.wait;
      await tx`update channels set topic = 'ab-2' where id = ${chB}::uuid`;
    });
    const t2 = sql!.begin(async (tx) => {
      await tx`update channels set topic = 'ba-1' where id = ${chB2}::uuid`;
      await step.wait;
      await tx`update channels set topic = 'ba-2' where id = ${chA2}::uuid`;
    });
    await sleep(100);
    step.open();
    await expect(Promise.all([t1, t2])).resolves.toBeTruthy();
  });

  it('answers a version 1 cursor with 409 RESET_REQUIRED, and garbage with 400', async () => {
    const legacy = Buffer.from(JSON.stringify({ revision: '42', scope: 'x', schema: 'y' })).toString('base64url');
    const old = await app!.request(`/v1/sync/changes?cursor=${legacy}`, { headers: asActor() });
    expect(old.status).toBe(409);
    expect(((await old.json()) as { code: string }).code).toBe('RESET_REQUIRED');
    expect((await app!.request('/v1/sync/changes?cursor=not-a-cursor', { headers: asActor() })).status).toBe(400);
  });

  it('resets a cursor behind a workspace\'s retention floor, and one whose membership changed', async () => {
    const before = await localBootstrap(store!.sql, actor);
    await topic(chA, 'after the floor');
    const keep = (await head(A))!.retained_after;
    await sql!`update sync_heads set retained_after = revision where workspace_id = ${A}::uuid`;
    try {
      expect(await localChanges(store!.sql, actor, cursorOf(before.cursor))).toBeNull();
    } finally {
      await sql!`update sync_heads set retained_after = ${keep}::bigint where workspace_id = ${A}::uuid`;
    }
    const fresh = await localBootstrap(store!.sql, actor);
    await sql!`insert into workspace_members (workspace_id, user_id, role) values ('a0000000-0000-0000-0000-00000000000a', ${actor.id}, 'member')`;
    try {
      expect(await localChanges(store!.sql, actor, cursorOf(fresh.cursor))).toBeNull();
    } finally {
      await sql!`delete from workspace_members where workspace_id = 'a0000000-0000-0000-0000-00000000000a' and user_id = ${actor.id}`;
    }
  });

  it('prunes one workspace\'s expired prefix, raises its floor, and leaves the others alone', async () => {
    const old = await localBootstrap(store!.sql, actor);
    await topic(chB, 'p1');
    await topic(chB, 'p2');
    const atHead = await localBootstrap(store!.sql, actor);
    const aCount = (await sql!<{ n: number }[]>`select count(*)::int as n from sync_changes where workspace_id = ${A}::uuid`)[0]!.n;
    await sql!`update sync_changes set created_at = now() - interval '40 days' where workspace_id = ${B}::uuid`;
    expect(await pruneLocalChanges(store!.sql)).toBeGreaterThan(0);
    expect((await sql!<{ n: number }[]>`select count(*)::int as n from sync_changes where workspace_id = ${B}::uuid`)[0]!.n).toBe(0);
    const h = (await head(B))!;
    expect(h.retained_after).toBe(h.revision);
    expect((await sql!<{ n: number }[]>`select count(*)::int as n from sync_changes where workspace_id = ${A}::uuid`)[0]!.n).toBe(aCount);
    expect(await localChanges(store!.sql, actor, cursorOf(old.cursor))).toBeNull();
    expect(await localChanges(store!.sql, actor, cursorOf(atHead.cursor))).not.toBeNull();
  });

  it('leaves the vector and tsvector columns out of the log, and records no change for an embedding alone', async () => {
    const sent = (await (await app!.request('/v1/messages', {
      method: 'POST', headers: asActor(), body: JSON.stringify({ workspace: A, channel: chA, body: `heavy ${tag}` }),
    })).json()) as { message?: { id: string } };
    const id = sent.message!.id;
    const [logged] = await sql!<{ row_data: Record<string, unknown> }[]>`
      select row_data from sync_changes where workspace_id = ${A}::uuid and table_name = 'messages' and row_id = ${id} order by seq desc limit 1`;
    expect(logged!.row_data['body']).toBe(`heavy ${tag}`);
    expect(logged!.row_data).not.toHaveProperty('fts');
    expect(logged!.row_data).not.toHaveProperty('embedding');
    const before = (await head(A))!.revision;
    await sql!`update messages set embedding = array_fill(0.1::real, array[384])::vector where id = ${id}::uuid`;
    expect((await head(A))!.revision).toBe(before);
  });

  it('records a whole workspace birth and its deletion while the feed is on: every row, and the cascade\'s tombstones', async () => {
    const before = await localBootstrap(store!.sql, actor);
    const made = (await (await app!.request('/v1/commands', {
      method: 'POST', headers: asActor(), body: JSON.stringify({ type: 'workspace.create', name: `${tag}-c`, slug: `${tag}-c` }),
    })).json()) as { workspaceId: string; channelId: string };
    expect(made.workspaceId).toBeTruthy();
    // the new membership is a scope change: the old cursor resets, and the new snapshot matches the log
    expect(await localChanges(store!.sql, actor, cursorOf(before.cursor))).toBeNull();
    const born = await localBootstrap(store!.sql, actor);
    const logged = await sql!<{ table_name: string; row_id: string }[]>`
      select distinct table_name, row_id from sync_changes where workspace_id = ${made.workspaceId}::uuid and row_data is not null`;
    const inLog = new Set(logged.map((r) => `${r.table_name}:${r.row_id}`));
    const ofC = born.changes.filter((c) => c.row && (c.row['workspace_id'] === made.workspaceId || (c.table === 'channel_members' && c.row['channel_id'] === made.channelId)));
    expect(ofC.length).toBeGreaterThan(0);
    expect(ofC.filter((c) => !inLog.has(`${c.table}:${c.id}`)).map((c) => `${c.table}:${c.id}`)).toEqual([]);
    const res = await app!.request('/v1/commands', { method: 'POST', headers: asActor(), body: JSON.stringify({ type: 'workspace.delete', workspace: made.workspaceId }) });
    expect(res.status).toBeLessThan(300);
    const tombstones = await sql!<{ table_name: string; row_id: string }[]>`
      select table_name, row_id from sync_changes where workspace_id = ${made.workspaceId}::uuid and row_data is null`;
    expect(tombstones.some((t) => t.table_name === 'channels' && t.row_id === made.channelId)).toBe(true);
  });

  it('a long-poll answers within a second of a write in its workspace, and only then', async () => {
    const hub = syncWakeFor(store!.sql);
    for (let i = 0; i < 50 && !hub.healthy; i++) await sleep(100);
    expect(hub.healthy).toBe(true);
    const boot = await localBootstrap(store!.sql, actor);
    const marker = `woken ${randomUUID()}`;
    const t0 = Date.now();
    const pending = app!.request(`/v1/sync/changes?cursor=${encodeURIComponent(boot.cursor)}&wait=10`, { headers: asActor() });
    await sleep(800);
    // a write in a workspace this person cannot read wakes nothing
    await topic(FIXTURE_CHANNEL, `elsewhere ${tag}`);
    await sleep(700);
    const wroteAt = Date.now();
    await topic(chA, marker);
    const res = await pending;
    const answeredAt = Date.now();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-nm-sync-wait')).toBe('25');
    const body = (await res.json()) as { changes: { row: Record<string, unknown> | null }[]; wait: number };
    expect(body.changes.some((c) => c.row?.['topic'] === marker)).toBe(true);
    expect(answeredAt - t0).toBeGreaterThan(1_400);
    expect(answeredAt - wroteAt).toBeLessThan(1_000);
    expect(body.wait).toBe(25);
  });

  it('an idle long-poll comes back after its wait with nothing, and the same cursor', async () => {
    const boot = await localBootstrap(store!.sql, actor);
    const t0 = Date.now();
    const res = await app!.request(`/v1/sync/changes?cursor=${encodeURIComponent(boot.cursor)}&wait=1`, { headers: asActor() });
    const body = (await res.json()) as { changes: unknown[]; cursor: string };
    expect(Date.now() - t0).toBeGreaterThan(700);
    expect(body.changes).toEqual([]);
    expect(body.cursor).toBe(boot.cursor);
  });

  // 0173: project_agents (upstream 0156) rides the per-workspace feed. Upstream 0159_project_replica_feed
  // wired it to the 0152 functions that our 0159 made no-ops, so before 0173 it reached no client.
  it('streams a project team change, its removal as a tombstone, and 0173 runs twice without change', async () => {
    const [project] = await sql!<{ id: string }[]>`select id from projects where workspace_id = ${A}::uuid limit 1`;
    const [agent] = await sql!<{ id: string }[]>`insert into agents (workspace_id, name, role, runtime, model)
      values (${A}::uuid, ${`${tag}-pa`}, 'worker', 'claude-code', 'test') returning id`;
    const before = await localBootstrap(store!.sql, actor);
    const [member] = await sql!<{ id: string }[]>`insert into project_agents (workspace_id, project_id, agent_id)
      values (${A}::uuid, ${project!.id}::uuid, ${agent!.id}::uuid) on conflict (project_id, agent_id) do update set agent_id = excluded.agent_id returning id`;
    const added = await localChanges(store!.sql, actor, cursorOf(before.cursor));
    expect(added!.changes.find((c) => c.table === 'project_agents' && c.id === member!.id)?.row?.['project_id']).toBe(project!.id);
    await sql!`delete from project_agents where id = ${member!.id}::uuid`;
    const removed = await localChanges(store!.sql, actor, cursorOf(added!.cursor));
    const tomb = removed!.changes.find((c) => c.table === 'project_agents' && c.id === member!.id);
    expect(tomb).toBeTruthy();
    expect(tomb!.row).toBeNull();
    const triggers = async () => (await sql!<{ n: number }[]>`
      select count(*)::int as n from pg_trigger where tgrelid = 'public.project_agents'::regclass and tgname in ('sync_note', 'sync_change')`)[0]!.n;
    expect(await triggers()).toBe(2);
    const migration = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/0173_sync_project_agents.sql', import.meta.url)), 'utf8');
    await sql!.begin((tx) => tx.unsafe(migration));
    expect(await triggers()).toBe(2);
  });
});
