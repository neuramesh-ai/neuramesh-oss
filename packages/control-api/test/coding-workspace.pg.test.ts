// The coding workspace of a thread (round 9, 0177) against the REAL schema. The memory twin is
// coding-workspace.test.ts. It locks: thread.set_kind {codeWorkspace: scratch} on a project with no
// repository writes kind coding and workspace_mode scratch, repo mode keeps REPO_REQUIRED, the birth
// option writes the column, the check constraint holds, and setThreadKindSql runs inside a transaction.
// Its own workspace, like coding-threads.pg.test.ts. Run via scripts/test-pg.sh. Skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { setThreadKindSql } from '../src/store/thread-machine';

const DB = process.env['DATABASE_URL'];
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const store = DB ? new PostgresStore(DB) : null;
// intake off: these sends test the birth and set_kind paths alone, and intake would flip a build ask itself (intake.pg.test.ts)
const app = store ? createApp(store, { intake: { env: { NM_INTAKE: 'off' } } }) : null;
const sql = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const post = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const rowOf = async (threadId: string) => (await sql!`select kind, workspace_mode from threads where id = ${threadId}::uuid`)[0] as { kind: string; workspace_mode: string | null } | undefined;

let george: Actor;
let WS = ''; let DEV = ''; let BARE = '';
const born = async (channel: string, opts: Record<string, unknown> = {}) => {
  const threadId = crypto.randomUUID();
  await post(george, '/v1/messages', { workspace: WS, channel, body: 'build a palindrome html app', threadId, ...opts });
  return threadId;
};

beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users (clerk_user_id, email) values ('clerk_cw_george', 'george@coding-workspace.test')
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  george = { kind: 'human', id: u!['id'] as string };
  WS = (await j(await post(george, '/v1/commands', { type: 'workspace.create', name: 'Coding Workspace', slug: `cw-${Date.now().toString(36)}` }))).workspaceId as string;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  const withRepo = await j(await post(george, '/v1/commands', { type: 'project.create', workspace: WS, name: 'Flowe AI' }));
  DEV = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: withRepo.projectId, slug: 'dev' }))).channelId as string;
  await post(george, '/v1/commands', { type: 'repo.link', workspace: WS, channel: DEV, url: 'https://github.com/flowe/app' });
  const bare = await j(await post(george, '/v1/commands', { type: 'project.create', workspace: WS, name: 'Bare' }));
  BARE = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: bare.projectId, slug: 'bare' }))).channelId as string;
});
afterAll(async () => { await store?.close(); await sql?.end(); });

describe.skipIf(!DB)('coding workspaces (0177) against real postgres', () => {
  it('scratch on a project with no repository: kind coding, workspace_mode scratch', async () => {
    const threadId = await born(BARE);
    const res = await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId, kind: 'coding', codeWorkspace: 'scratch' });
    expect(res.status).toBe(200);
    expect(await j(res)).toMatchObject({ kind: 'coding', codeWorkspace: 'scratch', repoId: null });
    expect(await rowOf(threadId)).toEqual({ kind: 'coding', workspace_mode: 'scratch' });
  });
  it('the orchestrator may make a scratch thread too', async () => {
    const threadId = await born(BARE);
    expect((await post(rex, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId, kind: 'coding', codeWorkspace: 'scratch' })).status).toBe(200);
  });
  it('repo mode keeps REPO_REQUIRED on a bare project, and records repo where there is one', async () => {
    const bare = await born(BARE);
    const refused = await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId: bare, kind: 'coding', codeWorkspace: 'repo' });
    expect(refused.status).toBe(422);
    expect(await rowOf(bare)).toEqual({ kind: 'chat', workspace_mode: null });
    const dev = await born(DEV);
    expect((await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId: dev, kind: 'coding', codeWorkspace: 'repo' })).status).toBe(200);
    expect(await rowOf(dev)).toEqual({ kind: 'coding', workspace_mode: 'repo' });
  });
  it('the old set_kind leaves workspace_mode unset, and back to chat clears it', async () => {
    const dev = await born(DEV);
    await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId: dev, kind: 'coding' });
    expect(await rowOf(dev)).toEqual({ kind: 'coding', workspace_mode: null });
    const s = await born(BARE, { threadKind: 'coding', threadWorkspace: 'scratch' });
    await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId: s, kind: 'chat' });
    expect(await rowOf(s)).toEqual({ kind: 'chat', workspace_mode: null });
  });
  it('the birth option writes the column, and a repo-chip birth is unchanged', async () => {
    expect(await rowOf(await born(BARE, { threadKind: 'coding', threadWorkspace: 'scratch' }))).toEqual({ kind: 'coding', workspace_mode: 'scratch' });
    expect(await rowOf(await born(DEV, { threadKind: 'coding' }))).toEqual({ kind: 'coding', workspace_mode: null });
    expect(await rowOf(await born(DEV, { threadWorkspace: 'scratch' }))).toEqual({ kind: 'chat', workspace_mode: null });
  });
  it('setThreadKindSql runs inside a transaction (the intake service binds with its own write)', async () => {
    const threadId = await born(BARE);
    await sql!.begin(async (tx) => { await setThreadKindSql(tx, WS, threadId, 'coding', 'scratch'); });
    expect(await rowOf(threadId)).toEqual({ kind: 'coding', workspace_mode: 'scratch' });
    await expect(sql!`update threads set workspace_mode = 'cloud' where id = ${threadId}::uuid`).rejects.toThrow(/workspace_mode/);
  });
});
