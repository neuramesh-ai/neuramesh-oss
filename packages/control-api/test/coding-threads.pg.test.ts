// Coding threads (0144) against the REAL schema — the memory twin is coding-threads.test.ts.
//
// What this locks down:
//   · the kind is born with the send (threads.kind, check-constrained) and defaults to chat
//   · thread.set_kind → coding needs a repository on the channel's project (REPO_REQUIRED), and
//     the orchestrator may move it as a human may
//   · a Code session whose id is a coding thread's id is LINKED to it on upsert
//     (code_sessions.thread_id); a session with a fresh id stays unlinked, as every legacy one
//
// Its own workspace, like code-sessions.pg.test.ts: the fixture workspace is on the trial plan
// (three projects), and a suite that spends one of those slots breaks a parallel suite's create.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const post = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
const kindOf = async (threadId: string) => (await sql!`select kind from threads where id = ${threadId}::uuid`)[0]?.['kind'] as string | undefined;

let george: Actor;
let WS = ''; let DEV = ''; let BARE = ''; let REPO = '';
const born = async (channel: string, opts: { threadKind?: 'chat' | 'coding' } = {}) => {
  const threadId = crypto.randomUUID();
  await post(george, '/v1/messages', { workspace: WS, channel, body: 'the sync watch drops replies after a reconnect', threadId, ...opts });
  return threadId;
};

beforeAll(async () => {
  if (!sql) return;
  george = await makeUser('clerk_ct_george', 'george@coding-threads.test');
  WS = (await j(await post(george, '/v1/commands', { type: 'workspace.create', name: 'Coding Threads', slug: `ct-${Date.now().toString(36)}` }))).workspaceId as string;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  // #dev: a room whose project has a repository, registered the product's way (repo.link binds it primary)
  const withRepo = await j(await post(george, '/v1/commands', { type: 'project.create', workspace: WS, name: 'Flowe AI' }));
  DEV = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: withRepo.projectId, slug: 'dev' }))).channelId as string;
  REPO = (await j(await post(george, '/v1/commands', { type: 'repo.link', workspace: WS, channel: DEV, url: 'https://github.com/flowe/app' }))).repoId as string;
  // #bare: a room whose project has none
  const bare = await j(await post(george, '/v1/commands', { type: 'project.create', workspace: WS, name: 'Bare' }));
  BARE = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: bare.projectId, slug: 'bare' }))).channelId as string;
});

afterAll(async () => { await store?.close(); await sql?.end(); });

describe.skipIf(!DB)('coding threads (0144) against real postgres', () => {
  it('the kind is born with the send, and defaults to chat', async () => {
    expect(await kindOf(await born(DEV, { threadKind: 'coding' }))).toBe('coding');
    expect(await kindOf(await born(DEV))).toBe('chat');
  });

  it('the check constraint refuses any other word', async () => {
    const threadId = await born(DEV);
    await expect(sql!`update threads set kind = 'review' where id = ${threadId}::uuid`).rejects.toThrow(/threads_kind_check/);
  });

  it('thread.set_kind → coding: a human on a project with a repository', async () => {
    const threadId = await born(DEV);
    const res = await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId, kind: 'coding' });
    expect(res.status).toBe(200);
    expect(await kindOf(threadId)).toBe('coding');
  });

  it('thread.set_kind → coding: the orchestrator too (ruling 1)', async () => {
    const threadId = await born(DEV);
    const res = await post(rex, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId, kind: 'coding' });
    expect(res.status).toBe(200);
    expect(await kindOf(threadId)).toBe('coding');
  });

  it('a project with no repository refuses code work with REPO_REQUIRED', async () => {
    const threadId = await born(BARE);
    const res = await post(george, '/v1/commands', { type: 'thread.set_kind', workspace: WS, threadId, kind: 'coding' });
    expect(res.status).toBe(422);
    expect((await j(res)).code).toBe('REPO_REQUIRED');
    expect(await kindOf(threadId)).toBe('chat');
  });

  it('a Code session whose id is a coding thread is linked to it; a fresh id stays unlinked', async () => {
    const threadId = await born(DEV, { threadKind: 'coding' });
    const linked = await post(george, '/v1/commands', { type: 'code_session.upsert', workspace: WS, codeSessionId: threadId, repoId: REPO, repoName: 'app', branch: 'main', mode: 'plan', state: 'idle', title: 'the sync watch' });
    expect(linked.status).toBe(200);
    expect((await sql!`select thread_id from code_sessions where id = ${threadId}::uuid`)[0]?.['thread_id']).toBe(threadId);
    const legacy = crypto.randomUUID();
    const bare = await post(george, '/v1/commands', { type: 'code_session.upsert', workspace: WS, codeSessionId: legacy, repoId: REPO, repoName: 'app', branch: 'main', mode: 'plan', state: 'idle' });
    expect(bare.status).toBe(200);
    expect((await sql!`select thread_id from code_sessions where id = ${legacy}::uuid`)[0]?.['thread_id']).toBeNull();
  });
});
