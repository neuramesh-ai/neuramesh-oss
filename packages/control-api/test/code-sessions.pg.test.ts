// Code sessions as synced rows (0135) against the REAL schema — the mobile-cloud round, S0.
//
// What this locks down (handler/codesession.ts):
//   · a member creates their own row as themselves; the event lands; the row is published
//   · another member cannot update it — the row names its member
//   · the OWNER of the hosting machine may create a row FOR another member on that machine
//     (a cloud runner speaks as its owner and works for everyone) and may update it later
//   · a machine from another workspace is refused; an agent actor is refused
//   · close stamps ended_at and the state; approval_waiting hands the route what the push needs
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
const uuid = () => globalThis.crypto.randomUUID();
const rowOf = async (id: string) => (await sql!`select * from code_sessions where id = ${id}::uuid`)[0] ?? null;

let owner: Actor; let mate: Actor; let stranger: Actor;
let WS = ''; let OTHER = '';
let machine = ''; let foreignMachine = '';

beforeAll(async () => {
  if (!sql) return;
  owner = await makeUser('clerk_cs_owner', 'owner@code-sessions.test');
  mate = await makeUser('clerk_cs_mate', 'mate@code-sessions.test');
  stranger = await makeUser('clerk_cs_stranger', 'stranger@code-sessions.test');
  WS = (await j(await send(owner, { type: 'workspace.create', name: 'Code Sessions', slug: `cs-${Date.now().toString(36)}` }))).workspaceId as string;
  OTHER = (await j(await send(stranger, { type: 'workspace.create', name: 'Elsewhere', slug: `cs-o-${Date.now().toString(36)}` }))).workspaceId as string;
  // the mate is a member (Team allows a second person) — straight through the rows, the invite
  // machinery is member-machines.pg.test.ts's subject
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${WS}::uuid, ${mate.id}::uuid, 'member') on conflict do nothing`;
  // the owner's machine (the host that speaks for the workspace), and one in the other workspace
  machine = (await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${owner.id}::uuid, 'owner-cloud', 'linux', '0.0.0', now(), '[]'::jsonb) returning id`)[0]!['id'] as string;
  foreignMachine = (await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${OTHER}::uuid, ${stranger.id}::uuid, 'foreign', 'linux', '0.0.0', now(), '[]'::jsonb) returning id`)[0]!['id'] as string;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('code_sessions (0135) — who writes a Code session\'s row', () => {
  it('is published for PowerSync', async () => {
    const rows = await sql!`select 1 from pg_publication_tables where pubname = 'powersync' and tablename = 'code_sessions'`;
    expect(rows).toHaveLength(1);
  });

  it('a member creates their own row as themselves, with the event', async () => {
    const id = uuid();
    const r = await send(mate, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, repoName: 'nm', branch: 'nm/engineering/mate/x', mode: 'plan' });
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ ok: true, codeSessionId: id, created: true });
    const row = await rowOf(id);
    expect(row).toMatchObject({ workspace_id: WS, created_by: mate.id, repo_name: 'nm', branch: 'nm/engineering/mate/x', mode: 'plan', state: 'idle' });
    const ev = await sql!`select payload from events where type = 'code_session.created' and workspace_id = ${WS}::uuid order by ts desc limit 1`;
    expect(ev[0]?.['payload']).toMatchObject({ createdBy: mate.id });
  });

  it('another member cannot update it, and an agent never writes one', async () => {
    const id = uuid();
    expect((await send(mate, { type: 'code_session.upsert', workspace: WS, codeSessionId: id })).status).toBe(200);
    const r = await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, title: 'hijack' });
    expect(r.status).toBe(403);
    expect((await j(r)).code).toBe('NOT_PERMITTED');
    const agent: Actor = { kind: 'agent', id: uuid(), role: 'developer' } as Actor;
    expect((await send(agent, { type: 'code_session.upsert', workspace: WS, codeSessionId: uuid() })).status).toBe(403);
    expect((await rowOf(id))?.['title']).toBe('');
  });

  it('the hosting machine\'s owner records a session FOR the member it works for, and may update it', async () => {
    const id = uuid();
    const r = await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, createdBy: mate.id, machineId: machine, repoName: 'nm', branch: 'b', mode: 'act', state: 'idle' });
    expect(r.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ created_by: mate.id, machine_id: machine });
    // the host's later patches ride the same door; the member's own do too
    expect((await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, state: 'streaming', title: 'Reuse relay-client', lastLine: 'Reuse relay-client for the phone' })).status).toBe(200);
    expect((await send(mate, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, mode: 'plan' })).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ state: 'streaming', title: 'Reuse relay-client', mode: 'plan' });
  });

  it('naming someone else without owning the hosting machine is refused; so is a foreign machine', async () => {
    const r1 = await send(mate, { type: 'code_session.upsert', workspace: WS, codeSessionId: uuid(), createdBy: owner.id, machineId: machine });
    expect((await j(r1)).code).toBe('NOT_PERMITTED');
    const r2 = await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: uuid(), machineId: foreignMachine });
    expect((await j(r2)).code).toBe('NOT_FOUND');
    const r3 = await send(stranger, { type: 'code_session.upsert', workspace: WS, codeSessionId: uuid() });
    expect((await j(r3)).code).toBe('NOT_PERMITTED');
  });

  it('close stamps the state and ended_at; approval_waiting hands the route the push facts', async () => {
    const id = uuid();
    await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, createdBy: mate.id, machineId: machine, title: 'Fix the trap' });
    const a = await j(await send(owner, { type: 'code_session.approval_waiting', workspace: WS, codeSessionId: id, approvalId: 'call-1', category: 'edit', toolName: 'apply_patch' }));
    expect(a).toMatchObject({ ok: true, ownerUserId: mate.id, title: 'Fix the trap', machineName: 'owner-cloud', approvalId: 'call-1', category: 'edit', toolName: 'apply_patch' });
    expect((await rowOf(id))?.['state']).toBe('awaiting_approval');
    const c = await send(owner, { type: 'code_session.close', workspace: WS, codeSessionId: id, state: 'completed', lastLine: 'done' });
    expect(c.status).toBe(200);
    const row = await rowOf(id);
    expect(row).toMatchObject({ state: 'completed', last_line: 'done' });
    expect(row?.['ended_at']).not.toBeNull();
    const ev = await sql!`select payload from events where type = 'code_session.closed' and workspace_id = ${WS}::uuid order by ts desc limit 1`;
    expect(ev[0]?.['payload']).toMatchObject({ state: 'completed' });
  });

  it('a session that re-opens after a close is live again — the upsert clears ended_at (the phone re-dials the lane it left)', async () => {
    const id = uuid();
    await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, createdBy: mate.id, machineId: machine, title: 'Re-dial' });
    await send(owner, { type: 'code_session.close', workspace: WS, codeSessionId: id, state: 'resumable' });
    expect((await rowOf(id))?.['ended_at']).not.toBeNull();
    const r = await send(owner, { type: 'code_session.upsert', workspace: WS, codeSessionId: id, state: 'streaming' });
    expect(r.status).toBe(200);
    const row = await rowOf(id);
    expect(row).toMatchObject({ state: 'streaming' });
    expect(row?.['ended_at']).toBeNull();
  });
});
