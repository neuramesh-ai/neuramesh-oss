// the GitHub card's life (docs/design/repo-connect-2026-10): a card a TOOL posts mints a Needs-you
// row, a card an agent types mints nothing, and the grant that connects GitHub for the project
// resumes every open card in its rooms in the same request: the conversation gets the divider as
// the person (which wakes rex), the task the claim blocked for GitHub goes back to work, any other
// task card gets the divider in the task's thread, and nothing resumes twice. Only the /v1 resolve
// resumes: the public install callback records the installation and nothing else, so a forged
// callback can neither connect a repository nor answer a card as a member.
import { GITHUB_NEED_PREFIX, githubConnectedMarker, needBlock, type Actor } from '@neuramesh/shared';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { forgetToken } from '../src/github-connect';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

// GitHub: installation 555 reads acme/site, and only after the test grants it. Installation 777 is
// an outsider's, on their own account: it reads only evil/bait
let granted = false;
const github: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const auth = String(new Headers(init?.headers).get('authorization') ?? '');
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/repos/acme/site/installation') return granted ? json({ id: 555, account: { login: 'acme' } }) : json({ message: 'Not Found' }, 404);
  if (path === '/app/installations/555/access_tokens') return json({ token: 'ghs_555', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  if (path === '/app/installations/555') return json({ account: { login: 'acme' }, repository_selection: 'selected' });
  if (path === '/app/installations/777/access_tokens') return json({ token: 'ghs_777', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  if (path === '/app/installations/777') return json({ account: { login: 'evil' }, repository_selection: 'selected' });
  if (path === '/installation/repositories') return json({ repositories: [{ full_name: auth === 'Bearer ghs_777' ? 'evil/bait' : 'acme/site' }] });
  if (path === '/repos/acme/site') return granted && auth === 'Bearer ghs_555' ? json({ private: true, default_branch: 'main' }) : json({ message: 'Not Found' }, 404);
  if (path === '/repos/evil/bait') return auth === 'Bearer ghs_777' ? json({ private: false, default_branch: 'main' }) : json({ message: 'Not Found' }, 404);
  return json({ message: 'Not Found' }, 404);
};

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let room: string;
let sibling: string;
let elsewhere: string;
const as = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const post = (actor: Actor, body: unknown) => app.request('/v1/messages', { method: 'POST', headers: as(actor), body: JSON.stringify(body) });
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', { method: 'POST', headers: as(actor), body: JSON.stringify(body) });
const resolve = (ch: string) => app.request('/v1/github/resolve', { method: 'POST', headers: as(george), body: JSON.stringify({ channel: ch }) });
const card = (channel: string, ask = 'The storage investigation') =>
  `I need to read the code in site for this, and this cloud machine cannot read it yet.\n\n${needBlock({ channel, ask, why: 'It reads the code.', connect: ['github'] })}`;
const needs = async () => (await store.listDecisions('ws_acme')).filter((d) => d.question.startsWith(GITHUB_NEED_PREFIX));
/** the grant: GitHub reads acme/site, and the install callback recorded installation 555 for the workspace */
const grant = async () => { granted = true; await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' }); };

beforeEach(async () => {
  store = new MemoryStore();
  granted = false;
  forgetToken(555);
  forgetToken(777);
  vi.stubEnv('GITHUB_APP_ID', '4994365');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', Buffer.from(pem).toString('base64'));
  vi.stubEnv('NM_CONNECTOR_KEY', 'test-connector-key');
  (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers.set('ws_acme', new Set(['george']));
  (store as unknown as { agentMeta: Map<string, { workspace: string; name: string; role: string }> }).agentMeta.set('rex', { workspace: 'ws_acme', name: 'rex', role: 'orchestrator' });
  room = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  sibling = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'ops', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  elsewhere = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p2', slug: 'site', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  store.announcements.seedRepo({ channelId: room, workspaceId: 'ws_acme', projectId: 'p1', repoId: 'r1', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
  app = createApp(store, { announce: { fetchFn: github } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('the card mints its Needs-you row only when a tool posts it', () => {
  it('a tool card mints one row that refuses free text, and the block stays in the message', async () => {
    const threadId = crypto.randomUUID();
    const res = await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room), needCard: true });
    expect(res.status).toBe(200);
    expect((await j(res)).message.body).toContain('```nmneed');
    const rows = await needs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', allowOther: false, question: `${GITHUB_NEED_PREFIX}The storage investigation waits to read the repository.` });
  });

  it('a card an agent types itself renders, and mints nothing', async () => {
    const res = await post(rex, { workspace: 'ws_acme', channel: room, threadId: crypto.randomUUID(), body: card(room) });
    expect(res.status).toBe(200);
    expect((await j(res)).message.body).toContain('```nmneed');
    expect(await needs()).toHaveLength(0);
  });
});

describe('the grant resumes the work', () => {
  it('a conversation gets the divider as the person, and the card leaves Needs you', async () => {
    const threadId = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room), needCard: true });
    await grant();
    const res = await resolve(room);
    expect(await j(res)).toMatchObject({ ok: true, handle: 'acme/site' });
    expect(await needs()).toEqual([expect.objectContaining({ status: 'answered', answer: 'Connected acme/site', answeredBy: { kind: 'human', id: 'george' } })]);
    const last = store.messages.filter((m) => m.threadId === threadId).at(-1)!;
    expect(last).toMatchObject({ body: githubConnectedMarker('acme/site'), author: { kind: 'human', id: 'george' }, channel: room });
  });

  it('resumes once: the card polls the resolve every 5 s, and the second answer finds nothing open', async () => {
    const threadId = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room), needCard: true });
    await grant();
    await resolve(room);
    await resolve(room);
    expect(store.messages.filter((m) => m.body === githubConnectedMarker('acme/site'))).toHaveLength(1);
  });

  it('a card in another room of the project resumes too, and a room of another project waits', async () => {
    const here = crypto.randomUUID();
    const there = crypto.randomUUID();
    const away = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: room, threadId: here, body: card(room, 'The audit'), needCard: true });
    await post(rex, { workspace: 'ws_acme', channel: sibling, threadId: there, body: card(sibling, 'The release notes'), needCard: true });
    await post(rex, { workspace: 'ws_acme', channel: elsewhere, threadId: away, body: card(elsewhere, 'The site ideas'), needCard: true });
    await grant();
    await resolve(room);
    const dividers = store.messages.filter((m) => m.body === githubConnectedMarker('acme/site')).map((m) => m.threadId);
    expect(dividers.sort()).toEqual([here, there].sort());
    expect((await needs()).find((d) => d.channel === elsewhere)?.status).toBe('open');
  });

  it('a task the card blocked goes back to work, with no divider in its thread', async () => {
    const created = await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: room, title: 'Standardize the storage interface', kind: 'feature', repo: { id: 'acme/site', baseRef: 'main' } }));
    const taskId = created.task.id as string;
    await send(patch, { type: 'task.claim', taskId });
    expect((await j(await send(patch, { type: 'task.block', taskId, reason: 'Waits for GitHub' }))).task.state).toBe('blocked');
    await post(patch, { workspace: 'ws_acme', channel: room, taskId, body: card(room, `#${created.task.number}`), needCard: true });
    await grant();
    await resolve(room);
    expect((await store.getTask(taskId))?.state).toBe('in_progress');
    expect((await needs())[0]?.status).toBe('answered');
    expect(store.messages.filter((m) => m.taskId === taskId && m.body === githubConnectedMarker('acme/site'))).toHaveLength(0);
  });

  it('a resolve that cannot read yet resumes nothing', async () => {
    const threadId = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room), needCard: true });
    expect((await j(await resolve(room))).ok).toBe(false);
    expect((await needs())[0]?.status).toBe('open');
    expect(store.messages.filter((m) => m.body === githubConnectedMarker('acme/site'))).toHaveLength(0);
  });

  it('a card on a task the claim did not block: the divider posts in the task\'s thread, and the task keeps its stage', async () => {
    const created = await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: room, title: 'Read the storage code', kind: 'feature' }));
    const taskId = created.task.id as string;
    expect(created.task.state).toBe('todo');
    await post(rex, { workspace: 'ws_acme', channel: room, taskId, body: card(room, `#${created.task.number}`), needCard: true });
    await grant();
    await resolve(room);
    expect((await store.getTask(taskId))?.state).toBe('todo');
    expect((await needs())[0]?.status).toBe('answered');
    expect(store.messages.filter((m) => m.taskId === taskId && m.body === githubConnectedMarker('acme/site')))
      .toEqual([expect.objectContaining({ threadId: null, channel: room, author: { kind: 'human', id: 'george' } })]);
  });

  it('a task blocked for another reason stays blocked, and its thread gets the divider', async () => {
    const created = await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: room, title: 'Publish the terms', kind: 'feature' }));
    const taskId = created.task.id as string;
    await send(patch, { type: 'task.claim', taskId });
    expect((await j(await send(patch, { type: 'task.block', taskId, reason: 'Waits on legal sign-off' }))).task.state).toBe('blocked');
    await post(rex, { workspace: 'ws_acme', channel: room, taskId, body: card(room, `#${created.task.number}`), needCard: true });
    await grant();
    await resolve(room);
    expect((await store.getTask(taskId))?.state).toBe('blocked');
    expect((await needs())[0]?.status).toBe('answered');
    expect(store.messages.filter((m) => m.taskId === taskId && m.body === githubConnectedMarker('acme/site'))).toHaveLength(1);
  });

  it('two conversations of one room with the same ask keep their own cards, and a re-ask supersedes only its own', async () => {
    const [t1, t2] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const threadId of [t1, t2, t1]) await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room, 'Release drafts'), needCard: true });
    expect((await needs()).map((d) => d.status).sort()).toEqual(['dismissed', 'open', 'open']);
    await grant();
    await resolve(room);
    const dividers = store.messages.filter((m) => m.body === githubConnectedMarker('acme/site')).map((m) => m.threadId);
    expect(dividers.sort()).toEqual([t1, t2].sort());
  });

  it('an agent\'s own question with the same prefix is no GitHub card: the grant never answers it', async () => {
    const threadId = crypto.randomUUID();
    const question = `${GITHUB_NEED_PREFIX}which branch should I read?`;
    await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: '```nmq\n' + JSON.stringify({ question, options: ['main', 'dev'] }) + '\n```' });
    expect(await needs()).toEqual([expect.objectContaining({ question, status: 'open' })]);
    await grant();
    await resolve(room);
    expect(await needs()).toEqual([expect.objectContaining({ question, status: 'open' })]);
    expect(store.messages.filter((m) => m.body === githubConnectedMarker('acme/site'))).toHaveLength(0);
  });

  it('a resume wakes the workspace\'s parked machines once, as a delivered message does', async () => {
    await post(rex, { workspace: 'ws_acme', channel: room, threadId: crypto.randomUUID(), body: card(room), needCard: true });
    const bump = vi.fn(async (_workspace: string, _origin?: string | null) => {});
    (store as unknown as { bumpMachineWake: typeof bump }).bumpMachineWake = bump;
    expect((await j(await resolve(room))).ok).toBe(false);
    expect(bump).not.toHaveBeenCalled();
    await grant();
    await resolve(room);
    await resolve(room);   // the card's next poll resumes nothing, and wakes nothing
    expect(bump.mock.calls).toEqual([['ws_acme', 'george']]);
  });
});

describe('only the /v1 resolve resumes', () => {
  /** the public start seals any person it names, with no session: the callback's state proves nobody */
  const callback = async (ch: string, installation: number): Promise<Response> => {
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${ch}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    return app.request(`/connect/github/callback?installation_id=${installation}&setup_action=install&state=${encodeURIComponent(state)}`);
  };
  it('the public install callback records the installation and nothing else, and the next /v1 resolve connects and resumes', async () => {
    const threadId = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: room, threadId, body: card(room), needCard: true });
    granted = true;
    expect(await (await callback(room, 555)).text()).toContain('The neuramesh app reads <b>acme/site</b>.');
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    expect((await needs())[0]?.status).toBe('open');
    expect(store.messages.filter((m) => m.body === githubConnectedMarker('acme/site'))).toHaveLength(0);
    await resolve(room);
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toMatchObject({ status: 'connected', handle: 'acme/site' });
    expect((await needs())[0]).toMatchObject({ status: 'answered', answeredBy: { kind: 'human', id: 'george' } });
    expect(store.messages.filter((m) => m.threadId === threadId && m.body === githubConnectedMarker('acme/site'))).toHaveLength(1);
  });
  it('a forged callback with an outsider\'s installation attaches nothing, and the member\'s own resolve resumes nothing', async () => {
    // a project with no GitHub repository, the case the card goes up for
    const threadId = crypto.randomUUID();
    await post(rex, { workspace: 'ws_acme', channel: elsewhere, threadId, body: card(elsewhere), needCard: true });
    expect((await callback(elsewhere, 777)).status).toBe(200);
    expect(await store.announcements.repoForChannel(elsewhere)).toBeNull();
    expect(await store.connectorWithSecret('ws_acme', 'github', elsewhere)).toBeNull();
    // the card asks the resolve when it mounts: the outsider's repository is a pick the person sees, never a connection
    expect(await j(await resolve(elsewhere))).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['evil/bait'] });
    expect(await store.connectorWithSecret('ws_acme', 'github', elsewhere)).toBeNull();
    expect((await needs())[0]?.status).toBe('open');
    expect(store.messages.filter((m) => m.body === githubConnectedMarker('evil/bait'))).toHaveLength(0);
  });
});
