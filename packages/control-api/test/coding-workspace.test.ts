// The coding workspace of a thread (round 9, 0177): a coding thread works in a worktree of a project
// repository or in a local scratch workspace with no repository. thread.set_kind {codeWorkspace} and
// the intake service share one gate (store/coding-workspace.ts bindCodingWorkspace). Scratch needs no
// repository, repo mode is the old rule, and the permissions are the same as before. The memory store
// is the contract. coding-workspace.pg.test.ts holds the same rules against the real schema.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';
import { bindCodingWorkspace } from '../src/store/coding-workspace';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'a-patch', role: 'developer' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };
const call = (path: string, actor: Actor, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
const born = async (opts: Record<string, unknown> = {}) => {
  const threadId = crypto.randomUUID();
  await call('/v1/messages', george, { ...base, body: 'build a palindrome html app', threadId, ...opts });
  return threadId;
};
const row = (threadId: string) => store.threads.find((t) => t.id === threadId);
const withRepo = () => store.announcements.seedRepo({ channelId: 'dev', workspaceId: 'ws_acme', projectId: null, repoId: '11111111-1111-4111-8111-111111111111', orgName: 'flowe', name: 'app', cloneUrl: 'https://github.com/flowe/app', provider: 'github' });
const setKind = (actor: Actor, threadId: string, extra: Record<string, unknown> = {}) =>
  call('/v1/commands', actor, { type: 'thread.set_kind', workspace: 'ws_acme', threadId, kind: 'coding', ...extra });

// the requests sign in with the x-nm-actor header. The package's test script opens that lane, and the
// sandbox CI runs vitest without the script (trial.test.ts does the same)
beforeEach(() => { vi.stubEnv('NM_ALLOW_ACTOR_HEADER', '1'); store = new MemoryStore(); app = createApp(store); });

describe('thread.set_kind {codeWorkspace: scratch}', () => {
  it('a human makes a coding thread with no repository on the project', async () => {
    const threadId = await born();
    const res = await setKind(george, threadId, { codeWorkspace: 'scratch' });
    expect(res.status).toBe(200);
    expect(await j(res)).toMatchObject({ ok: true, threadId, kind: 'coding', codeWorkspace: 'scratch', repoId: null });
    expect(row(threadId)).toMatchObject({ kind: 'coding', workspaceMode: 'scratch' });
  });
  it('the orchestrator may too, and any other agent is refused', async () => {
    const a = await born(); const b = await born();
    expect((await setKind(rex, a, { codeWorkspace: 'scratch' })).status).toBe(200);
    const refused = await setKind(patch, b, { codeWorkspace: 'scratch' });
    expect(refused.status).toBe(403);
    expect((await j(refused)).code).toBe('NOT_PERMITTED');
    expect(row(b)).toMatchObject({ kind: 'chat' });
  });
  it('a task thread is refused with TASK_THREAD', async () => {
    const threadId = await born();
    await store.linkThreadTask('ws_acme', threadId, 't-1046');
    const res = await setKind(george, threadId, { codeWorkspace: 'scratch' });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('TASK_THREAD');
  });
  it('a scratch thread back to chat clears its workspace mode', async () => {
    const threadId = await born();
    await setKind(george, threadId, { codeWorkspace: 'scratch' });
    expect((await setKind(george, threadId, { kind: 'chat' })).status).toBe(200);
    expect(row(threadId)).toMatchObject({ kind: 'chat', workspaceMode: null });
  });
});

describe('thread.set_kind {codeWorkspace: repo} and the old rule are unchanged', () => {
  it('repo mode needs a repository: REPO_REQUIRED without one', async () => {
    const threadId = await born();
    const res = await setKind(george, threadId, { codeWorkspace: 'repo' });
    expect(res.status).toBe(422);
    expect((await j(res)).code).toBe('REPO_REQUIRED');
    expect(row(threadId)).toMatchObject({ kind: 'chat' });
  });
  it('repo mode with a repository records repo and names it', async () => {
    withRepo();
    const threadId = await born();
    const res = await setKind(george, threadId, { codeWorkspace: 'repo' });
    expect(await j(res)).toMatchObject({ kind: 'coding', codeWorkspace: 'repo', repoId: '11111111-1111-4111-8111-111111111111' });
    expect(row(threadId)).toMatchObject({ kind: 'coding', workspaceMode: 'repo' });
  });
  it('a repoId the project does not have is REPO_REQUIRED', async () => {
    withRepo();
    const threadId = await born();
    const res = await setKind(george, threadId, { codeWorkspace: 'repo', repoId: '22222222-2222-4222-8222-222222222222' });
    expect(res.status).toBe(422);
  });
  it('no codeWorkspace: the old rule, and workspace_mode stays unset', async () => {
    const bare = await born();
    expect((await j(await setKind(george, bare))).code).toBe('REPO_REQUIRED');
    withRepo();
    const threadId = await born();
    expect((await setKind(george, threadId)).status).toBe(200);
    expect(row(threadId)?.kind).toBe('coding');
    expect(row(threadId)?.workspaceMode ?? null).toBeNull();
  });
});

describe('the birth option and the intake gate', () => {
  it('a send with threadKind coding and threadWorkspace scratch births a scratch coding thread', async () => {
    const threadId = await born({ threadKind: 'coding', threadWorkspace: 'scratch' });
    expect(row(threadId)).toMatchObject({ kind: 'coding', workspaceMode: 'scratch' });
  });
  it('a repo-chip birth is unchanged, and threadWorkspace on a chat birth is ignored', async () => {
    expect(row(await born({ threadKind: 'coding' }))?.workspaceMode ?? null).toBeNull();
    expect(row(await born({ threadWorkspace: 'scratch' }))).toMatchObject({ kind: 'chat', workspaceMode: null });
  });
  it('bindCodingWorkspace is the gate the intake service calls (no actor, the same refusals)', async () => {
    const threadId = await born();
    expect(await bindCodingWorkspace(store, { workspace: 'ws_acme', threadId, mode: 'scratch' })).toEqual({ threadId, kind: 'coding', codeWorkspace: 'scratch', repoId: null });
    await expect(bindCodingWorkspace(store, { workspace: 'ws_acme', threadId: crypto.randomUUID(), mode: 'scratch' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(bindCodingWorkspace(store, { workspace: 'ws_acme', threadId: await born(), mode: 'repo' })).rejects.toMatchObject({ code: 'REPO_REQUIRED' });
  });
});
