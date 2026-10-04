// the connected divider is a record, never the person's word (docs/design/repo-connect-2026-10). the
// grant posts `‹github:connected:…›` as the person in a task's thread, and the accept floor reads a
// human message in that thread newer than the review verdict as the word an agent accept needs. the
// divider must not count, or a grant lets rex accept (and merge) work the person never said to merge.
import { githubConnectedMarker, needBlock, type Actor } from '@neuramesh/shared';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { forgetToken } from '../src/github-connect';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const tick = () => new Promise((r) => setTimeout(r, 5));

// GitHub: installation 555 reads acme/site
const github: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const auth = String(new Headers(init?.headers).get('authorization') ?? '');
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/app/installations/555/access_tokens') return json({ token: 'ghs_555', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  if (path === '/app/installations/555') return json({ account: { login: 'acme' }, repository_selection: 'selected' });
  if (path === '/installation/repositories') return json({ repositories: [{ full_name: 'acme/site' }] });
  if (path === '/repos/acme/site') return auth === 'Bearer ghs_555' ? json({ private: true, default_branch: 'main' }) : json({ message: 'Not Found' }, 404);
  return json({ message: 'Not Found' }, 404);
};

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let room: string;
const as = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', { method: 'POST', headers: as(actor), body: JSON.stringify(body) });

beforeEach(async () => {
  store = new MemoryStore();
  forgetToken(555);
  vi.stubEnv('GITHUB_APP_ID', '4994365');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', Buffer.from(pem).toString('base64'));
  vi.stubEnv('NM_CONNECTOR_KEY', 'test-connector-key');
  (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers.set('ws_acme', new Set(['george']));
  room = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  store.announcements.seedRepo({ channelId: room, workspaceId: 'ws_acme', projectId: 'p1', repoId: 'r1', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
  app = createApp(store, { announce: { fetchFn: github } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('the connected divider is no human word', () => {
  it('a grant after the verdict posts the divider in the task thread, and an agent accept still needs the person to speak', async () => {
    const { task } = await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: room, title: 'Ship the inbox', kind: 'docs' }));
    expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['scope agreed'] })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'notes.md' }] })).status).toBe(200);
    await tick();
    expect((await j(await send(gem, { type: 'task.approve', taskId: task.id }))).task.state).toBe('done');
    await tick();
    // rex reads the repository in the done task's thread and its tool posts the GitHub card
    const body = `I need to read the code for this.\n\n${needBlock({ channel: room, ask: `#${task.number}`, why: 'It reads the code.', connect: ['github'] })}`;
    expect((await app.request('/v1/messages', { method: 'POST', headers: as(rex), body: JSON.stringify({ workspace: 'ws_acme', channel: room, taskId: task.id, body, needCard: true }) })).status).toBe(200);
    expect((await j(await send(rex, { type: 'task.accept', taskId: task.id }))).code).toBe('HUMAN_ONLY');
    // the grant: the divider posts as the person in the task's thread
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
    const resolved = await app.request('/v1/github/resolve', { method: 'POST', headers: as(george), body: JSON.stringify({ channel: room }) });
    expect((await j(resolved)).ok).toBe(true);
    expect(store.messages.filter((m) => m.taskId === task.id && m.body === githubConnectedMarker('acme/site'))).toHaveLength(1);
    // the person never said merge
    const res = await send(rex, { type: 'task.accept', taskId: task.id });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
    expect((await store.getTask(task.id))?.state).toBe('done');
  });
});
