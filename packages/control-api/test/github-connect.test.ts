// GitHub as a connector (docs/design/github-connector-2026-09): the in-app grant (the sealed state
// on the two /connect/github routes), the resolve, the three reads through the App, the ACL the
// `connectors` row IS, and the dead grant's verdict. GitHub is a fixture; the App key is a test key.
import type { Actor } from '@neuramesh/shared';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { unseal } from '../src/connector-crypto';
import { forgetToken } from '../src/github-connect';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const stranger: Actor = { kind: 'human', id: 'mallory' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const as = (actor: Actor) => ({ 'x-nm-actor': JSON.stringify(actor) });
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

const RELEASE = { tag_name: 'v0.1.0', name: 'v0.1.0', body: 'The first cut.', published_at: '2026-09-16T15:00:00Z', html_url: 'https://github.com/acme/site/releases/tag/v0.1.0', draft: false, prerelease: false };
const PULL = { number: 7, title: 'The shared inbox', body: '', labels: [], merged_at: '2026-09-16T10:00:00Z', html_url: 'https://github.com/acme/site/pull/7', user: { login: 'maya' } };
const README = Buffer.from('# Site\n\nThe marketing site.\n').toString('base64');

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let calls: string[];
/** GitHub: acme/site is private; installation 555 (selected: acme/site) reads it; installation 777 is on all of `orgall` */
let gone = false;
/** what installation 555 reads: one repository unless a test grants more */
let repos555 = ['acme/site'];
/** what installation 777 lists */
let repos777 = ['orgall/one'];
/** one full page of GitHub's repository list (rememberInstallation reads 100), every name with this owner */
const firstPage = (owner: string): string[] => Array.from({ length: 100 }, (_, i) => `${owner}/r${i}`);
const github: typeof fetch = async (input, init) => {
  const url = String(input);
  const path = new URL(url).pathname + (new URL(url).search || '');
  const auth = String(new Headers(init?.headers).get('authorization') ?? '');
  calls.push(`${init?.method ?? 'GET'} ${path} ${auth.startsWith('Bearer ghs_') ? 'installation' : auth.startsWith('Bearer ') ? 'app' : 'anon'}`);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const installed = auth === 'Bearer ghs_555' && !gone;
  if (path === '/repos/acme/site/installation') return gone ? json({ message: 'Not Found' }, 404) : json({ id: 555, account: { login: 'acme' } });
  if (path === '/app/installations/555/access_tokens') return gone ? json({ message: 'Not Found' }, 404) : json({ token: 'ghs_555', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  if (path === '/app/installations/555') return json({ account: { login: 'acme' }, repository_selection: 'selected' });
  if (path === '/app/installations/777/access_tokens') return json({ token: 'ghs_777', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  if (path === '/app/installations/777') return json({ account: { login: 'orgall' }, repository_selection: 'all' });
  if (path === '/installation/repositories?per_page=100') return json({ repositories: (auth === 'Bearer ghs_777' ? repos777 : repos555).map((full_name) => ({ full_name })) });
  if (path === '/repos/acme/site') return installed ? json({ private: true, homepage: 'https://acme.dev', default_branch: 'main', description: 'the site' }) : json({ message: 'Not Found' }, 404);
  if (path === '/repos/acme/docs') return installed && repos555.includes('acme/docs') ? json({ private: false, default_branch: 'trunk' }) : json({ message: 'Not Found' }, 404);
  if (path === '/repos/acme/docs/installation') return repos555.includes('acme/docs') && !gone ? json({ id: 555, account: { login: 'acme' } }) : json({ message: 'Not Found' }, 404);
  if (path.startsWith('/repos/acme/site/releases')) return installed ? json([RELEASE]) : json({ message: 'Not Found' }, 404);
  if (path.startsWith('/repos/acme/site/pulls')) return json([PULL]);
  if (path.startsWith('/repos/acme/site/commits')) return json([{ sha: 'abc1234', html_url: 'https://github.com/acme/site/commit/abc1234', commit: { message: 'Ship the inbox\n\nlong body', author: { date: '2026-09-16T09:00:00Z', name: 'Maya' } }, author: { login: 'maya' } }]);
  if (path === '/repos/acme/site/contents/README.md') return json({ type: 'file', size: 30, sha: 'r1', encoding: 'base64', content: README });
  if (path === '/repos/acme/site/contents/logo.png') return json({ type: 'file', size: 4, sha: 'p1', encoding: 'base64', content: Buffer.from([0x89, 0, 0x4e, 0x47]).toString('base64') });
  if (path === '/repos/acme/site/contents/docs') return json([{ type: 'file', path: 'docs/a.md' }]);
  if (path === '/repos/acme/site/git/trees/HEAD?recursive=1') return json({ truncated: false, tree: [{ path: 'README.md', type: 'blob', size: 30 }, { path: 'docs', type: 'tree' }, { path: 'docs/a.md', type: 'blob', size: 5 }, { path: 'src/x.ts', type: 'blob', size: 9 }] });
  return json({ message: 'Not Found' }, 404);
};

let channel: string;
let other: string;
beforeEach(async () => {
  store = new MemoryStore();
  calls = [];
  gone = false;
  repos555 = ['acme/site'];
  repos777 = ['orgall/one'];
  forgetToken(555);
  vi.stubEnv('GITHUB_APP_ID', '4994365');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', Buffer.from(pem).toString('base64'));
  vi.stubEnv('NM_CONNECTOR_KEY', 'test-connector-key');
  (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers.set('ws_acme', new Set(['george']));
  (store as unknown as { agentMeta: Map<string, { workspace: string; name: string; role: string }> }).agentMeta.set('rex', { workspace: 'ws_acme', name: 'rex', role: 'orchestrator' });
  channel = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'marketing', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  other = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p2', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  store.announcements.seedRepo({ channelId: channel, workspaceId: 'ws_acme', projectId: 'p1', repoId: 'r1', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
  app = createApp(store, { announce: { fetchFn: github } });
});
afterEach(() => { vi.unstubAllEnvs(); });

const resolve = (ch: string, actor: Actor = george, more: Record<string, unknown> = {}) => app.request('/v1/github/resolve', { method: 'POST', headers: { 'content-type': 'application/json', ...as(actor) }, body: JSON.stringify({ channel: ch, ...more }) });
const read = (path: string, ch: string, actor: Actor = rex) => app.request(`/v1/repo/${path}${path.includes('?') ? '&' : '?'}channel=${ch}`, { headers: as(actor) });
/** the grant as the install callback records it: installation 555, for ws_acme */
const grant = () => store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
/** the resolve's words for a live grant no workspace recorded (the public door's, or a read's repair) */
const STRANDED = 'The neuramesh app reads acme/site, but this workspace did not install it. On GitHub, uninstall the neuramesh app from acme, then grant access again here.';

describe('the doors', () => {
  it('start, in the app: a sealed state that names the workspace, the room, the person and the repository', async () => {
    const r = await app.request(`/connect/github/start?workspace=ws_acme&channel=${channel}&actor=george`);
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://github.com/apps/neuramesh/installations/new');
    expect(unseal(to.searchParams.get('state')!)).toEqual({ github: 1, workspace: 'ws_acme', channel, actor: 'george', slug: 'acme/site' });
  });
  it('start, the public door: the slug rides as the state, unchanged', async () => {
    const r = await app.request('/connect/github/start?repo=acme/site');
    expect(new URL(r.headers.get('location')!).searchParams.get('state')).toBe('acme/site');
  });
  it('the callback with the sealed state records the installation for the workspace and nothing else: the signed-in resolve connects', async () => {
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${channel}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('The neuramesh app reads <b>acme/site</b>.');
    expect(html).toContain('Return to neuramesh to finish.');
    // the state and the installation_id prove no person: no row until a signed-in member resolves
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toBeNull();
    expect(store.announcements.installations[0]).toMatchObject({ installationId: 555, workspaceId: 'ws_acme', selection: 'selected', repos: ['acme/site'] });
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toMatchObject({ status: 'connected', handle: 'acme/site', ciphertext: null });
  });
  it('the callback of a grant that reads no repository sends the person back to GitHub', async () => {
    repos555 = [];
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${channel}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(await r.text()).toContain('The neuramesh app reads no repository yet.');
    expect(store.announcements.installations[0]).toMatchObject({ installationId: 555, workspaceId: 'ws_acme', repos: [] });
  });
  it('the callback with a slug state is still the public door', async () => {
    const r = await app.request('/connect/github/callback?installation_id=555&setup_action=install&state=acme%2Fsite');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('/announce?granted=1');
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toBeNull();
  });
});

describe('POST /v1/github/resolve', () => {
  it('writes the row when an installation of the workspace reads the repository, and answers the install door when none does', async () => {
    const miss = await j(await resolve(channel));
    expect(miss).toMatchObject({ ok: false, code: 'NOT_INSTALLED', repos: [], hint: null });
    expect(miss.install).toContain('https://github.com/apps/neuramesh/installations/new?state=');
    // the grant removed on GitHub: the dead installation is forgotten, and the door stays
    await grant();
    gone = true;
    expect(await j(await resolve(channel))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', repos: [] });
    expect(store.announcements.installations).toEqual([]);
    gone = false;
    await grant();
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toMatchObject({ status: 'connected', handle: 'acme/site' });
  });
  it('a repository past the first page of a selection connects: GitHub names the installation, and the workspace recorded it', async () => {
    repos555 = firstPage('acme');   // acme/site is on the second page
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: repos555, selection: 'selected', workspaceId: 'ws_acme' });
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect(calls).toContain('GET /repos/acme/site/installation app');
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toMatchObject({ status: 'connected', handle: 'acme/site' });
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: 'ws_acme', repos: repos555 })]);
  });
  it('a room whose project has no repository, a stranger, and an agent are each refused by name', async () => {
    expect(await j(await resolve(other))).toMatchObject({ ok: false, code: 'NO_REPO', repos: [], hint: null });
    expect((await resolve('no-such-room')).status).toBe(404);
    expect((await resolve(channel, stranger)).status).toBe(403);
    expect((await resolve(channel, rex)).status).toBe(403);
  });
  it('an installation on all repositories resolves by account', async () => {
    await store.announcements.upsertInstallation({ installationId: 777, account: 'orgall', repos: ['orgall/one'], selection: 'all' });
    expect(await store.announcements.installationForRepo('orgall/new-repo')).toEqual({ installationId: 777 });
    expect(await store.announcements.installationForRepo('acme/site')).toBeNull();
  });
});

describe('the pick (plan §7): the grant first, the repository comes back with it', () => {
  let folder: string;
  const link = (ch: string, body: Record<string, unknown>) => app.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', ...as(george) }, body: JSON.stringify({ type: 'repo.link', workspace: 'ws_acme', channel: ch, ...body }) });
  beforeEach(async () => {
    folder = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p3', slug: 'folder', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
    // a folder attached from a desktop: the project's primary, with no GitHub side
    expect((await link(folder, { localPath: '/home/george/code/site', name: 'site' })).status).toBe(200);
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local', name: 'site', cloneUrl: null });
  });
  it('a folder project with nothing readable: NO_REPO with the install door, nothing attached', async () => {
    const r = await j(await resolve(folder));
    expect(r).toMatchObject({ ok: false, code: 'NO_REPO', repos: [], hint: null });
    expect(r.error).toContain('site is a folder on a machine');
    expect(r.install).toContain('installations/new?state=');
  });
  it('the App reads repositories for the workspace: the pick, the folder\'s namesake as the hint, and an open step never attaches', async () => {
    repos555 = ['acme/site', 'acme/docs'];
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
    const r = await j(await resolve(folder));
    // refreshed from GitHub: the list carries the repository added since the memo
    expect(r).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['acme/docs', 'acme/site'], hint: 'acme/site' });
    expect(r.error).toBe('Pick the repository site lives in.');
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toBeNull();
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
  });
  it('the pick attaches the repository to the project (a second repository beside the folder) and writes the row', async () => {
    repos555 = ['acme/site', 'acme/docs'];
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
    expect(await j(await resolve(folder, george, { repo: 'acme/docs' }))).toEqual({ ok: true, handle: 'acme/docs', attached: true });
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toMatchObject({ status: 'connected', handle: 'acme/docs' });
    // the connector's repository is the GitHub-addressed one now, the folder stays linked too
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'acme', name: 'docs', cloneUrl: 'https://github.com/acme/docs.git', provider: 'github' });
    expect(store.announcements.repoLinks.filter((l) => l.channelId === folder).map((l) => l.name).sort()).toEqual(['docs', 'site']);
    expect((store as unknown as { repos: Array<{ name: string; defaultBranch: string }> }).repos.find((x) => x.name === 'docs')).toMatchObject({ defaultBranch: 'trunk' });
    // a second resolve is the plain path: read, connected, nothing re-attached
    expect(await j(await resolve(folder))).toEqual({ ok: true, handle: 'acme/docs', attached: false });
    // the reads work through it
    expect((await read('tree', folder)).status).toBe(400);   // acme/docs has no tree in the fixture: the read reached GitHub for it
    expect(calls.some((c) => c.startsWith('GET /repos/acme/docs/git/trees'))).toBe(true);
  });
  it('a pick the App cannot read is refused by name, and nothing is attached', async () => {
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
    const r = await j(await resolve(folder, george, { repo: 'acme/secret' }));
    expect(r).toMatchObject({ ok: false, code: 'NOT_INSTALLED', repos: ['acme/site'] });
    expect(r.error).toContain('cannot read acme/secret');
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
  });
  it('the callback of a grant for a folder project attaches nothing: the one repository it reads is the pick, named like the folder', async () => {
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${folder}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    expect(unseal(state)).toMatchObject({ channel: folder, slug: null });
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(await r.text()).toContain('The neuramesh app reads <b>acme/site</b>.');
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toBeNull();
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
    // the person's one click: the step pre-selects the hint, and the pick attaches and connects
    expect(await j(await resolve(folder))).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['acme/site'], hint: 'acme/site' });
    expect(await j(await resolve(folder, george, { repo: 'acme/site' }))).toEqual({ ok: true, handle: 'acme/site', attached: true });
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'acme', name: 'site', provider: 'github' });
  });
  it('the callback of a grant that reads several: the page counts them and sends the person to the pick', async () => {
    repos555 = ['acme/site', 'acme/docs'];
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${folder}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(await r.text()).toContain('reads 2 repositories');
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toBeNull();
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
  });
  it('a dead installation in the workspace list is forgotten by the refresh, a live one is read', async () => {
    await store.announcements.upsertInstallation({ installationId: 424242, account: 'acme', repos: ['acme/old'], selection: 'selected', workspaceId: 'ws_acme' });
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: [], selection: 'selected', workspaceId: 'ws_acme' });
    expect(await j(await resolve(folder))).toMatchObject({ ok: false, repos: ['acme/site'], hint: 'acme/site' });
    expect(store.announcements.installations.map((i) => i.installationId)).toEqual([555]);
  });
  it('a pick beside a GitHub primary the app cannot read becomes the repository the reads use', async () => {
    repos555 = ['acme/docs'];
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/docs'], selection: 'selected', workspaceId: 'ws_acme' });
    expect(await j(await resolve(channel))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: expect.stringContaining('cannot read acme/site'), repos: ['acme/docs'] });
    expect(await j(await resolve(channel, george, { repo: 'acme/docs' }))).toEqual({ ok: true, handle: 'acme/docs', attached: true });
    // the primary acme/site stays linked and sorts first, and the connected row names the pick
    expect(store.announcements.repoLinks.filter((l) => l.channelId === channel).map((l) => l.name)).toEqual(['site', 'docs']);
    expect(await store.announcements.repoForChannel(channel)).toMatchObject({ orgName: 'acme', name: 'docs' });
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/docs', attached: false });
    await read('tree', channel);
    expect(calls.some((c) => c.startsWith('GET /repos/acme/docs/git/trees'))).toBe(true);
    // the grant dies under the pick: the row waits for a new grant, and the words still name the pick
    const conn = (await store.connectorWithSecret('ws_acme', 'github', channel))!;
    await store.markConnectorReauth(conn.id);
    expect(await store.announcements.repoForChannel(channel)).toMatchObject({ orgName: 'acme', name: 'docs' });
    expect(await j(await read('tree', channel))).toMatchObject({ code: 'RECONNECT_REQUIRED', error: expect.stringContaining('read acme/docs.') });
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/docs', attached: false });
    // a person's disconnect names nothing: the old order comes back
    await store.revokeConnector(conn.id, (workspace) => ({ type: 'connector.revoked', workspace }) as never);
    expect(await store.announcements.repoForChannel(channel)).toMatchObject({ orgName: 'acme', name: 'site' });
  });
});

describe('the resolve connects only what the workspace granted', () => {
  let theirs: string;
  const link = (body: Record<string, unknown>) => app.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', ...as(stranger) }, body: JSON.stringify({ type: 'repo.link', workspace: 'ws_evil', channel: theirs, ...body }) });
  beforeEach(async () => {
    (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers.set('ws_evil', new Set(['mallory']));
    theirs = (await store.createChannel({ workspace: 'ws_evil', projectId: 'pE', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_evil' } as never)).id;
  });
  it('a pick of another workspace\'s private repository is refused, and nothing is attached or written', async () => {
    await grant();
    const r = await j(await resolve(theirs, stranger, { repo: 'acme/site' }));
    expect(r).toMatchObject({ ok: false, code: 'NOT_INSTALLED', repos: [] });
    expect(r.error).toContain('cannot read acme/site');
    expect(await store.connectorWithSecret('ws_evil', 'github', theirs)).toBeNull();
    expect(await store.announcements.repoForChannel(theirs)).toBeNull();
    expect((await j(await read('file?path=README.md', theirs, stranger))).code).toBe('NO_REPO');
  });
  it('its slug linked in the room is refused too, and the GitHub-wide lookup never moves the grant', async () => {
    expect((await link({ url: 'https://github.com/acme/site' })).status).toBe(200);
    // no row on this server: the GitHub-wide lookup would find 555 and record it for ws_evil
    expect(await j(await resolve(theirs, stranger))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: expect.stringContaining('acme/site'), repos: [] });
    expect(calls.some((c) => c.includes('/repos/acme/site/installation'))).toBe(false);
    expect(store.announcements.installations).toEqual([]);
    // ws_acme's own grant on this server does not read for ws_evil either, and the words say nothing about it
    await grant();
    expect(await j(await resolve(theirs, stranger))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: 'The neuramesh app is not installed on acme/site. Grant access on GitHub.' });
    expect(await store.connectorWithSecret('ws_evil', 'github', theirs)).toBeNull();
    expect((await j(await read('file?path=README.md', theirs, stranger))).code).toBe('NOT_CONNECTED');
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: 'ws_acme' })]);
  });
  it('past a full first page of its own grant, GitHub\'s answer that names another workspace\'s installation connects nothing', async () => {
    repos555 = firstPage('acme');
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: repos555, selection: 'selected', workspaceId: 'ws_acme' });
    repos777 = firstPage('orgall');
    await store.announcements.upsertInstallation({ installationId: 777, account: 'orgall', repos: repos777, selection: 'all', workspaceId: 'ws_evil' });
    expect((await link({ url: 'https://github.com/acme/site' })).status).toBe(200);
    expect(await j(await resolve(theirs, stranger))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: expect.stringContaining('cannot read acme/site') });
    // GitHub was asked, and its answer (555) is not an installation of ws_evil
    expect(calls).toContain('GET /repos/acme/site/installation app');
    expect(await store.connectorWithSecret('ws_evil', 'github', theirs)).toBeNull();
    expect(store.announcements.installations.find((i) => i.installationId === 555)).toMatchObject({ workspaceId: 'ws_acme', repos: repos555 });
  });
});

describe('the reads', () => {
  beforeEach(grant);
  it('refuse without the row: the connectors row is the ACL, not the installation', async () => {
    // GitHub WOULD read it (the installation exists), and the answer is still no
    expect(await j(await read('changes', channel))).toMatchObject({ code: 'NOT_CONNECTED' });
    expect(calls.filter((c) => c.includes('installation'))).toEqual([]);
  });
  it('changes: releases, merged pull requests, commits, and the repository facts, through the App', async () => {
    await resolve(channel);
    const r = await j(await read('changes?since=2026-09-10T00:00:00Z', channel));
    expect(r).toMatchObject({ slug: 'acme/site', releases: [{ tag: 'v0.1.0' }], prs: [{ number: 7 }], commits: [{ sha: 'abc1234', message: 'Ship the inbox', author: 'maya' }], repo: { defaultBranch: 'main', private: true } });
    expect(calls.some((c) => c.startsWith('GET /repos/acme/site/releases') && c.endsWith('installation'))).toBe(true);
  });
  it('file: text comes back, a binary and a directory are refused by name, a missing path is 404', async () => {
    await resolve(channel);
    expect(await j(await read('file?path=README.md', channel))).toMatchObject({ path: 'README.md', content: '# Site\n\nThe marketing site.\n', truncated: false });
    const bin = await read('file?path=logo.png', channel);
    expect(bin.status).toBe(400);
    expect((await j(bin)).error).toContain('binary');
    expect((await j(await read('file?path=docs', channel))).error).toContain('directory');
    expect((await read('file?path=nope.md', channel)).status).toBe(400);
    expect((await j(await read('file?path=nope.md', channel))).code).toBe('NOT_FOUND');
    expect((await j(await read('file?path=../etc', channel))).error).toContain('climb');
  });
  it('tree: the whole tree, or the entries under a path', async () => {
    await resolve(channel);
    const all = await j(await read('tree', channel));
    expect(all.entries.map((e: { path: string }) => e.path)).toEqual(['README.md', 'docs', 'docs/a.md', 'src/x.ts']);
    const docs = await j(await read('tree?path=docs', channel));
    expect(docs.entries).toEqual([{ path: 'docs/a.md', type: 'blob', size: 5 }]);
    expect((await read('tree?path=nowhere', channel)).status).toBe(400);
  });
  it('a human member reads too; a stranger and a wrong room are refused', async () => {
    await resolve(channel);
    expect((await read('tree', channel, george)).status).toBe(200);
    expect((await read('tree', channel, stranger)).status).toBe(403);
    expect((await j(await read('tree', other))).code).toBe('NO_REPO');
  });
  it('one token per installation per hour: three reads mint once', async () => {
    await resolve(channel);
    calls.length = 0;
    await read('tree', channel); await read('file?path=README.md', channel); await read('changes', channel);
    expect(calls.filter((c) => c.includes('/access_tokens')).length).toBe(0);
  });
  it('the grant removed on GitHub: the row turns reauth_required and the read says reconnect', async () => {
    await resolve(channel);
    gone = true;
    forgetToken(555);
    const r = await read('changes', channel);
    expect(r.status).toBe(409);
    expect((await j(r)).code).toBe('RECONNECT_REQUIRED');
    expect((await store.connectorWithSecret('ws_acme', 'github', channel))?.status).toBe('reauth_required');
    // and a second read does not touch GitHub: the row is the verdict now
    calls.length = 0;
    expect((await read('changes', channel)).status).toBe(409);
    expect(calls).toEqual([]);
  });
  it('a stale row for the same repository (the live harness held a fake id) loses to GitHub\'s own answer and is forgotten', async () => {
    await resolve(channel);
    await store.announcements.forgetInstallation(555);
    await store.announcements.upsertInstallation({ installationId: 424242, account: 'acme', repos: ['acme/site'], selection: 'selected' });
    expect((await read('tree', channel)).status).toBe(200);
    expect(store.announcements.installations.map((i) => i.installationId)).toEqual([555]);
    expect(calls).toContain('POST /app/installations/424242/access_tokens app');
    expect(calls).toContain('GET /repos/acme/site/installation app');
    // the repair records the reinstall for no workspace: the room keeps its working connection, so the
    // resolve answers connected as the reads do, and never tells the person to uninstall a working grant
    expect(store.announcements.installations[0]?.workspaceId).toBeNull();
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect((await read('tree', channel)).status).toBe(200);
    // a grant GitHub no longer has is forgotten, and the plain words come back
    gone = true;
    forgetToken(555);
    expect(await j(await resolve(channel))).toMatchObject({ ok: false, error: 'The neuramesh app is not installed on acme/site. Grant access on GitHub.' });
    expect(store.announcements.installations).toEqual([]);
  });
});

describe('a grant no workspace recorded: the public door, then the claim, then the resolve', () => {
  it('the claimed room names the way out, and the grant from the app connects it', async () => {
    // the door: the person installs the app on GitHub from neuramesh.app/announce, for no workspace
    const door = await app.request('/connect/github/callback?installation_id=555&setup_action=install&state=acme%2Fsite');
    expect(door.headers.get('location')).toContain('/announce?granted=1');
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: null })]);
    const made = (await store.announcements.create({ repo: 'acme/site', tag: 'v0.1.0', website: 'acme.dev', email: 'g@acme.dev', private: true, installationId: 555, ipHash: null }))!;
    await store.announcements.update(made.id, { status: 'ready', posts: [{ platform: 'x', body: 'v0.1.0 is out.' }] });
    // the claim, signed in: a project and its marketing room, with the repository linked
    const claim = await app.request(`/v1/announce/${made.id}/claim`, { method: 'POST', headers: { 'content-type': 'application/json', ...as(george) }, body: JSON.stringify({ workspace: 'ws_acme' }) });
    expect(claim.status).toBe(200);
    const out = await j(claim);
    // the memory world tracks no project_repos: the claim's link reads back as the postgres join reads it
    const linked = (store as unknown as { repos: Array<{ id: string; name: string }> }).repos.find((r) => r.name === 'site')!;
    store.announcements.seedRepo({ channelId: out.channelId, workspaceId: 'ws_acme', projectId: out.projectId, repoId: linked.id, orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
    const r = await j(await resolve(out.channelId));
    expect(r).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: STRANDED, repos: [] });
    expect(r.install).toContain('installations/new?state=');
    expect(await store.connectorWithSecret('ws_acme', 'github', out.channelId)).toBeNull();
    // the way out ends in the grant from the app: its callback records the installation for the workspace
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${out.channelId}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(await j(await resolve(out.channelId))).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });

  it('a room that already holds the connection keeps it: the resolve answers connected, as the reads do', async () => {
    // a row connected before the scoping, through a grant that no workspace recorded
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: null });
    await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'github', handle: 'acme/site', connectedBy: 'george', scopes: 'metadata:read' });
    expect((await read('tree', channel)).status).toBe(200);
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    // the grant stays unrecorded: holding a row never stamps the installation onto the workspace
    expect(store.announcements.installations[0]).toMatchObject({ installationId: 555, workspaceId: null });
    // a room with no connected row still gets the way out
    expect(await j(await resolve(other))).toMatchObject({ ok: false });
  });
});
