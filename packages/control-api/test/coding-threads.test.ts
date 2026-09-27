// Coding threads (0144, docs/design/coding-threads-2026-09): the KIND is born with the send and
// moved only by thread.set_kind — a human, or the room's orchestrator from its triage turn
// (ruling 1, 2026-09-26). Two refusals are structural: a thread that carries a task is already
// the code path, and a coding thread needs a repository to work on. The memory store is the
// contract; coding-threads.pg.test.ts locks the same rules against the real schema.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'a-patch', role: 'developer' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };

const send = (actor: Actor, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
const cmd = (actor: Actor, body: unknown) =>
  app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
const born = async (opts: { threadKind?: 'chat' | 'coding' } = {}) => {
  const threadId = crypto.randomUUID();
  await send(george, { ...base, body: 'the sync watch drops replies after a reconnect', threadId, ...opts });
  return threadId;
};
const kindOf = (threadId: string) => store.threads.find((t) => t.id === threadId)?.kind;
/** the memory world tracks no project_repos: the room's repository is seeded on the announce store */
const withRepo = () => store.announcements.seedRepo({ channelId: 'dev', workspaceId: 'ws_acme', projectId: null, repoId: 'r-app', orgName: 'flowe', name: 'app', cloneUrl: 'https://github.com/flowe/app', provider: 'github' });

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('the kind is born with the send', () => {
  it('a send with the repo chip set births a CODING thread', async () => {
    const threadId = await born({ threadKind: 'coding' });
    expect(kindOf(threadId)).toBe('coding');
  });
  it('a send that names no kind is a conversation — every existing caller is unchanged', async () => {
    const threadId = await born();
    expect(kindOf(threadId)).toBe('chat');
  });
  it('a LATER message cannot re-kind the conversation', async () => {
    const threadId = await born();
    await send(george, { ...base, body: 'and fix it', threadId, threadKind: 'coding' });
    expect(kindOf(threadId)).toBe('chat');
  });
});

describe('thread.set_kind — who moves it, and the two structural refusals', () => {
  it('a human moves a conversation onto the coding runtime when the project has a repository', async () => {
    withRepo();
    const threadId = await born();
    const res = await cmd(george, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding' });
    expect(res.status).toBe(200);
    expect(await j(res)).toMatchObject({ ok: true, threadId, kind: 'coding' });
    expect(kindOf(threadId)).toBe('coding');
  });
  it('the orchestrator moves it too — its triage turn decides the code path (ruling 1)', async () => {
    withRepo();
    const threadId = await born();
    const res = await cmd(rex, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding' });
    expect(res.status).toBe(200);
    expect(kindOf(threadId)).toBe('coding');
  });
  it('any other agent is refused by the server, not by the registry', async () => {
    withRepo();
    const threadId = await born();
    const res = await cmd(patch, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding' });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('NOT_PERMITTED');
    expect(kindOf(threadId)).toBe('chat');
  });
  it('a project with no repository cannot host code work — REPO_REQUIRED names the fix', async () => {
    const threadId = await born();
    const res = await cmd(george, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding' });
    expect(res.status).toBe(422);
    expect((await j(res)).code).toBe('REPO_REQUIRED');
    expect(kindOf(threadId)).toBe('chat');
  });
  it('back to chat needs no repository', async () => {
    withRepo();
    const threadId = await born({ threadKind: 'coding' });
    store.announcements.repoLinks.length = 0;
    const res = await cmd(george, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'chat' });
    expect(res.status).toBe(200);
    expect(kindOf(threadId)).toBe('chat');
  });
  it('a task thread is already the code path — TASK_THREAD, whoever asks', async () => {
    withRepo();
    const threadId = await born();
    await store.linkThreadTask('ws_acme', threadId, 't-1046');
    for (const who of [george, rex]) {
      const res = await cmd(who, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding' });
      expect(res.status).toBe(409);
      expect((await j(res)).code).toBe('TASK_THREAD');
    }
    expect(kindOf(threadId)).toBe('chat');
  });
  it('an unknown thread is NOT_FOUND', async () => {
    const res = await cmd(george, { type: 'thread.set_kind', workspace: 'ws_acme', threadId: crypto.randomUUID(), kind: 'coding' });
    expect(res.status).toBe(404);
  });
});
