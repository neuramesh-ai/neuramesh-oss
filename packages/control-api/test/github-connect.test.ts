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
  if (path === '/installation/repositories?per_page=100') return json({ repositories: auth === 'Bearer ghs_777' ? [{ full_name: 'orgall/one' }] : [{ full_name: 'acme/site' }] });
  if (path === '/repos/acme/site') return installed ? json({ private: true, homepage: 'https://acme.dev', default_branch: 'main', description: 'the site' }) : json({ message: 'Not Found' }, 404);
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

const resolve = (ch: string, actor: Actor = george) => app.request('/v1/github/resolve', { method: 'POST', headers: { 'content-type': 'application/json', ...as(actor) }, body: JSON.stringify({ channel: ch }) });
const read = (path: string, ch: string, actor: Actor = rex) => app.request(`/v1/repo/${path}${path.includes('?') ? '&' : '?'}channel=${ch}`, { headers: as(actor) });

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
  it('the callback with the sealed state remembers the installation for the workspace and writes the row', async () => {
    const start = await app.request(`/connect/github/start?workspace=ws_acme&channel=${channel}&actor=george`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('acme/site</b> is connected');
    const conn = await store.connectorWithSecret('ws_acme', 'github', channel);
    expect(conn).toMatchObject({ status: 'connected', handle: 'acme/site', ciphertext: null });
    expect(store.announcements.installations[0]).toMatchObject({ installationId: 555, workspaceId: 'ws_acme', selection: 'selected', repos: ['acme/site'] });
  });
  it('the callback with a slug state is still the public door', async () => {
    const r = await app.request('/connect/github/callback?installation_id=555&setup_action=install&state=acme%2Fsite');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('/announce?granted=1');
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toBeNull();
  });
});

describe('POST /v1/github/resolve', () => {
  it('writes the row when the App reads the repository, and answers the install door when it does not', async () => {
    gone = true;
    const miss = await j(await resolve(channel));
    expect(miss).toMatchObject({ ok: false, code: 'NOT_INSTALLED' });
    expect(miss.install).toContain('https://github.com/apps/neuramesh/installations/new?state=');
    gone = false;
    forgetToken(555);
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site' });
    expect(await store.connectorWithSecret('ws_acme', 'github', channel)).toMatchObject({ status: 'connected', handle: 'acme/site' });
  });
  it('a room whose project has no repository, a stranger, and an agent are each refused by name', async () => {
    expect(await j(await resolve(other))).toMatchObject({ ok: false, code: 'NO_REPO' });
    expect((await resolve(channel, stranger)).status).toBe(403);
    expect((await resolve(channel, rex)).status).toBe(403);
  });
  it('a stale row for the same repository (the live harness held a fake id) loses to GitHub\'s own answer and is forgotten', async () => {
    await store.announcements.upsertInstallation({ installationId: 424242, account: 'acme', repos: ['acme/site'], selection: 'selected' });
    expect(await j(await resolve(channel))).toEqual({ ok: true, handle: 'acme/site' });
    expect(store.announcements.installations.map((i) => i.installationId)).toEqual([555]);
    expect(calls).toContain('POST /app/installations/424242/access_tokens app');
    expect(calls).toContain('GET /repos/acme/site/installation app');
  });
  it('an installation on all repositories resolves by account', async () => {
    await store.announcements.upsertInstallation({ installationId: 777, account: 'orgall', repos: ['orgall/one'], selection: 'all' });
    expect(await store.announcements.installationForRepo('orgall/new-repo')).toEqual({ installationId: 777 });
    expect(await store.announcements.installationForRepo('acme/site')).toBeNull();
  });
});

describe('the reads', () => {
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
});
