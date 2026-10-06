// The GitHub owner proof (docs/design/github-owner-proof-2026-10/plan.md): GitHub does not sign the
// installation_id of its Setup URL, so with the proof on, a grant starts at GitHub's authorize page,
// the Setup URL only sends the browser on, and only the signed-in prove call writes: a proof row of
// what the person's own GitHub account reads, and the room's connection when that covers the room.
// GitHub is a fixture: users, their codes, the App's installations, and what each user token lists.
import { GITHUB_NEED_PREFIX, githubConnectedMarker, needBlock, type Actor } from '@neuramesh/shared';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { seal } from '../src/connector-crypto';
import { forgetToken } from '../src/github-connect';
import { sealProofState, unsealProofState } from '../src/github-proof';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const mallory: Actor = { kind: 'human', id: 'mallory' };
const walt: Actor = { kind: 'human', id: 'walt' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const as = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const CLIENT_ID = 'Iv1.testclient';
const SECRET = 'client-secret-do-not-print';
const HQ_CALLBACK = 'https://hq.neuramesh.app/github/callback';
const s256 = (v: string): string => createHash('sha256').update(v).digest('base64url');

// ── GitHub, the fixture ────────────────────────────────────────────────────────────────────────
type Inst = { account: string; type: 'User' | 'Organization'; selection: 'all' | 'selected'; repos: string[]; suspended?: boolean };
/** the App's installations, by id */
let installs: Record<number, Inst>;
/** each user token: the account, what its lists show per installation (the person's own access), and the
 *  organizations whose SAML single sign-on refuses it */
let users: Record<string, { id: number; login: string; sees: Record<number, string[]>; direct?: Record<string, boolean>; sso?: string[] }>;
/** each code: the token it gives, a GitHub error field, or an HTTP status */
let codes: Record<string, string | { error: string } | { status: number; headers?: Record<string, string> }>;
/** the PKCE challenge of the link that GitHub gave a code for: such a code redeems only with its verifier */
let issued: Record<string, string | null>;
/** a path that answers this status (a 503, a rate limit), or a path with one kind of token (`/repos/acme/site installation`) */
let failing: Record<string, { status: number; headers?: Record<string, string>; message?: string }>;
/** a path that GitHub never answers, with this kind of token */
let dead: Set<string>;
/** GitHub's repository ids; a repository GitHub made again under the same name gets a new one */
let ids: Record<string, number>;
// GitHub's names are not case sensitive
const idOf = (slug: string): number => (ids[slug.toLowerCase()] ??= 7000 + Object.keys(ids).length);
let calls: string[];
let exchanges: Array<Record<string, string>>;
let deletes: Array<{ what: string; basic: string; body: unknown }>;

const github: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const path = url.pathname + url.search;
  const method = init?.method ?? 'GET';
  const auth = String(new Headers(init?.headers).get('authorization') ?? '');
  const kind = auth.startsWith('Bearer ghu_') ? 'user' : auth.startsWith('Bearer ghs_') ? 'installation' : auth.startsWith('Basic ') ? 'basic' : auth ? 'app' : 'anon';
  calls.push(`${method} ${path} ${kind}`);
  if (dead.has(`${url.pathname} ${kind}`)) throw new TypeError('fetch failed');
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fail = failing[`${url.pathname} ${kind}`] ?? failing[url.pathname];
  if (fail) return json({ message: fail.message ?? 'busy' }, fail.status, fail.headers);
  const page = Number(url.searchParams.get('page') ?? '1');
  const slice = <T>(xs: T[]): T[] => xs.slice((page - 1) * 100, page * 100);
  if (url.host === 'github.com' && url.pathname === '/login/oauth/access_token') {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    exchanges.push(body);
    const challenge = issued[body['code'] ?? ''];
    if (challenge && s256(body['code_verifier'] ?? '') !== challenge) return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
    const out = codes[body['code'] ?? ''];
    if (out === undefined) return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
    if (typeof out === 'string') return json({ access_token: out, token_type: 'bearer', scope: '' });
    if ('error' in out) return json({ error: out.error });
    return json({ message: 'down' }, out.status, out.headers);
  }
  const deleted = /^\/applications\/([^/]+)\/(token|grant)$/.exec(url.pathname);
  if (deleted && method === 'DELETE') { deletes.push({ what: deleted[2]!, basic: auth, body: JSON.parse(String(init?.body)) }); return new Response(null, { status: 204 }); }
  const user = kind === 'user' ? users[auth.slice('Bearer '.length)] : undefined;
  const instRow = (id: number) => ({ id, account: { login: installs[id]!.account, type: installs[id]!.type }, target_type: installs[id]!.type, repository_selection: installs[id]!.selection, suspended_at: installs[id]!.suspended ? '2026-10-01T00:00:00Z' : null });
  if (url.pathname === '/user') return user ? json({ id: user.id, login: user.login }) : json({ message: 'Bad credentials' }, 401);
  if (url.pathname === '/user/installations') {
    const listed = Object.keys(user?.sees ?? {}).map(Number);
    return json({ total_count: listed.length, installations: slice(listed).map(instRow) });
  }
  const userRepos = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
  if (userRepos) {
    const seen = user?.sees[Number(userRepos[1])];
    return seen ? json({ total_count: seen.length, repositories: slice(seen).map((s) => ({ id: idOf(s), full_name: s })) }) : json({ message: 'Not Found' }, 404);
  }
  const covering = (slug: string): number | undefined => Object.keys(installs).map(Number).find((id) => installs[id]!.repos.includes(slug.toLowerCase()) || (installs[id]!.selection === 'all' && slug.toLowerCase().startsWith(`${installs[id]!.account.toLowerCase()}/`)));
  const instOf = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url.pathname);
  if (instOf) { const id = covering(instOf[1]!); return id ? json(instRow(id)) : json({ message: 'Not Found' }, 404); }
  const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
  if (mint) return installs[Number(mint[1])] ? json({ token: `ghs_${mint[1]}`, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201) : json({ message: 'Not Found' }, 404);
  const facts = /^\/app\/installations\/(\d+)$/.exec(url.pathname);
  if (facts) { const i = installs[Number(facts[1])]; return i ? json({ account: { login: i.account }, repository_selection: i.selection }) : json({ message: 'Not Found' }, 404); }
  if (url.pathname === '/installation/repositories') return json({ repositories: (installs[Number(auth.slice('Bearer ghs_'.length))]?.repos ?? []).map((full_name) => ({ full_name })) });
  const tree = /^\/repos\/([^/]+\/[^/]+)\/git\/trees\/[^/]+$/.exec(url.pathname);
  if (tree && kind === 'installation') return covering(tree[1]!) === Number(auth.slice('Bearer ghs_'.length)) ? json({ tree: [{ path: 'README.md', type: 'blob', size: 12 }], truncated: false }) : json({ message: 'Not Found' }, 404);
  const repo = /^\/repos\/([^/]+\/[^/]+)$/.exec(url.pathname);
  if (repo) {
    const slug = repo[1]!;
    if (kind === 'installation') return covering(slug) === Number(auth.slice('Bearer ghs_'.length)) ? json({ id: idOf(slug), full_name: slug, private: true, default_branch: 'main' }) : json({ message: 'Not Found' }, 404);
    if (user?.sso?.includes(slug.split('/')[0]!)) return json({ message: 'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.' }, 403, { 'x-github-sso': `required; url=https://github.com/orgs/${slug.split('/')[0]}/sso?authorization_request=r1` });
    if (user && slug in (user.direct ?? {})) return json({ id: idOf(slug), full_name: slug, private: user.direct![slug], permissions: { pull: true, push: false } });
    if (user && Object.values(user.sees).some((s) => s.includes(slug))) return json({ id: idOf(slug), full_name: slug, private: true, permissions: { pull: true } });
    return json({ message: 'Not Found' }, 404);
  }
  return json({ message: 'Not Found' }, 404);
};

// ── the world ──────────────────────────────────────────────────────────────────────────────────
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let room: string;     // project p1, names acme/site
let bare: string;     // project p2, names no repository
let theirs: string;   // ws_evil's room
const members = () => (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers;
const connectors = () => (store as unknown as { connectors: Array<{ projectId: string | null; handle: string; status: string }> }).connectors;

beforeEach(async () => {
  store = new MemoryStore();
  installs = { 555: { account: 'acme', type: 'Organization', selection: 'selected', repos: ['acme/site', 'acme/docs'] } };
  users = { ghu_george: { id: 11, login: 'george-gh', sees: { 555: ['acme/site'] } }, ghu_mallory: { id: 66, login: 'mallory-gh', sees: {} } };
  codes = { c_george: 'ghu_george', c_mallory: 'ghu_mallory' };
  issued = {};
  failing = {};
  dead = new Set();
  ids = { 'acme/site': 1001, 'acme/docs': 1002 };
  calls = [];
  exchanges = [];
  deletes = [];
  for (const id of [555, 777, 888, 999]) forgetToken(id);
  vi.stubEnv('GITHUB_APP_ID', '4994365');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', Buffer.from(pem).toString('base64'));
  vi.stubEnv('NM_CONNECTOR_KEY', 'test-connector-key');
  vi.stubEnv('GITHUB_APP_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', SECRET);
  members().set('ws_acme', new Set(['george']));
  members().set('ws_evil', new Set(['mallory']));
  (store as unknown as { agentMeta: Map<string, { workspace: string; name: string; role: string }> }).agentMeta.set('rex', { workspace: 'ws_acme', name: 'rex', role: 'orchestrator' });
  room = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'marketing', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  bare = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p2', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  theirs = (await store.createChannel({ workspace: 'ws_evil', projectId: 'pE', slug: 'evil', topic: '' }, { type: 'test', workspace: 'ws_evil' } as never)).id;
  store.announcements.seedRepo({ channelId: room, workspaceId: 'ws_acme', projectId: 'p1', repoId: 'r1', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
  app = createApp(store, { announce: { fetchFn: github } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const resolve = (ch: string, actor: Actor = george, more: Record<string, unknown> = {}) => app.request('/v1/github/resolve', { method: 'POST', headers: as(actor), body: JSON.stringify({ channel: ch, ...more }) });
const prove = (actor: Actor, body: Record<string, unknown>) => app.request('/v1/github/prove', { method: 'POST', headers: as(actor), body: JSON.stringify(body) });
/** the grant link the resolve gives: the state its authorize page carries */
const stateFor = async (ch: string, actor: Actor = george): Promise<string> => new URL((await j(await resolve(ch, actor))).authorize).searchParams.get('state')!;
const proofs = () => store.githubProofs.rows;
const linkFolder = async (ch: string) => {
  const r = await app.request('/v1/commands', { method: 'POST', headers: as(george), body: JSON.stringify({ type: 'repo.link', workspace: 'ws_acme', channel: ch, localPath: '/home/george/code/site', name: 'site' }) });
  expect(r.status).toBe(200);
};
const folderRoom = async (): Promise<string> => {
  const id = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p3', slug: 'folder', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  await linkFolder(id);
  return id;
};

describe('the grant link', () => {
  it('the resolve answers PROVE with the authorize page and the install page, one state for both', async () => {
    const r = await j(await resolve(room));
    expect(r).toMatchObject({ ok: false, code: 'PROVE', repos: [], hint: null });
    const authorize = new URL(r.authorize);
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authorize.searchParams.get('redirect_uri')).toBe(HQ_CALLBACK);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorize.searchParams.get('state')!;
    expect(state.startsWith('w.')).toBe(true);
    expect(new URL(r.install).searchParams.get('state')).toBe(state);
    expect(r.install).toContain('https://github.com/apps/neuramesh/installations/new?state=');
    const sealed = unsealProofState(state)!;
    expect(sealed.client).toBe('w');
    expect(sealed.state).toMatchObject({ github: 1, workspace: 'ws_acme', channel: room, actor: 'george', slug: 'acme/site' });
    expect(Math.abs(sealed.state.iat - Date.now() / 1000)).toBeLessThan(5);
    expect(sealed.state.nonce.length).toBeGreaterThan(10);
    // the phone's grant: the same state, marked for the app outside the seal, and a new nonce each time
    const phone = new URL((await j(await resolve(room, george, { client: 'phone' }))).authorize).searchParams.get('state')!;
    expect(phone.startsWith('p.')).toBe(true);
    expect(unsealProofState(phone)!.state.nonce).not.toBe(sealed.state.nonce);
    expect(calls).toEqual([]);
  });

  it('the proof off: the resolve keeps today\'s install link, and authorize is null', async () => {
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    const r = await j(await resolve(room));
    expect(r).toMatchObject({ ok: false, code: 'NOT_INSTALLED', authorize: null });
    expect(r.install).toContain('installations/new?state=');
    expect(new URL(r.install).searchParams.get('state')!.startsWith('w.')).toBe(false);
  });

  it('the public start sends the browser to hq\'s start page with the room alone: the query names no person', async () => {
    const r = await app.request(`/connect/github/start?workspace=ws_acme&channel=${room}&actor=george`);
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://hq.neuramesh.app/github/start');
    expect(Object.fromEntries(to.searchParams)).toEqual({ channel: room });
    expect((await app.request('/connect/github/start?workspace=ws_acme&actor=george')).headers.get('location')).toBe('https://hq.neuramesh.app/github/start');
    expect(calls).toEqual([]);
    // off, the start keeps today's install page
    vi.stubEnv('GITHUB_APP_CLIENT_ID', '');
    const off = new URL((await app.request(`/connect/github/start?workspace=ws_acme&channel=${room}&actor=george`)).headers.get('location')!);
    expect(off.origin + off.pathname).toBe('https://github.com/apps/neuramesh/installations/new');
  });

  it('a stranger who forwards a start link proves nothing: her code and the link\'s state write no proof for the victim', async () => {
    // george's project holds a folder named site, and mallory's own GitHub account reads mallory/site through the App
    const folder = await folderRoom();
    installs[777] = { account: 'mallory', type: 'User', selection: 'selected', repos: ['mallory/site'] };
    users['ghu_mallory']!.sees = { 777: ['mallory/site'] };
    // mallory, with no session, opens the public start with george's workspace, room and id
    const to = new URL((await app.request(`/connect/github/start?workspace=ws_acme&channel=${folder}&actor=george`)).headers.get('location')!);
    // she authorizes with her own account and sends george hq's callback link: hq sends the prove with his session
    const forwarded = to.searchParams.get('state') ?? '';
    expect(await j(await prove(george, { code: 'c_mallory', state: forwarded }))).toMatchObject({ ok: false, code: 'BAD_STATE' });
    expect(proofs()).toEqual([]);
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('the rollback: a proof state that reaches the Setup URL with the proof off records the installation for its workspace', async () => {
    const state = await stateFor(room);
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(state)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('The neuramesh app reads');
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: 'ws_acme' })]);
  });

  it('the Setup URL hop keeps the state, records nothing and asks GitHub nothing', async () => {
    const state = await stateFor(room);
    for (const action of ['install', 'update']) {
      const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=${action}&state=${encodeURIComponent(state)}`);
      expect(r.status).toBe(302);
      const to = new URL(r.headers.get('location')!);
      expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(to.searchParams.get('state')).toBe(state);
    }
    // a member's request, and GitHub's own error, end on hq's page with the same state
    const request = new URL((await app.request(`/connect/github/callback?setup_action=request&state=${encodeURIComponent(state)}`)).headers.get('location')!);
    expect(request.origin + request.pathname).toBe(HQ_CALLBACK);
    expect(Object.fromEntries(request.searchParams)).toEqual({ error: 'request', state });
    const denied = new URL((await app.request(`/connect/github/callback?error=access_denied&state=${encodeURIComponent(state)}`)).headers.get('location')!);
    expect(Object.fromEntries(denied.searchParams)).toEqual({ error: 'access_denied', state });
    expect(store.announcements.installations).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('the forged installation_id (the old hole) records nothing', async () => {
    // mallory holds a sealed state for her own workspace and names acme's installation
    const old = seal({ github: 1, workspace: 'ws_evil', channel: theirs, actor: 'mallory', slug: null });
    const r = await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(old)}`);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('The grant did not land.');
    const fresh = await stateFor(theirs, mallory);
    expect((await app.request(`/connect/github/callback?installation_id=555&setup_action=install&state=${encodeURIComponent(fresh)}`)).status).toBe(302);
    expect(store.announcements.installations).toEqual([]);
    expect(calls).toEqual([]);
    // and her own account reads nothing of acme: the prove call proves her nothing, and her room stays empty
    expect(await j(await prove(mallory, { code: 'c_mallory', state: fresh }))).toEqual({ ok: true, outcome: 'install', install: expect.stringContaining('installations/new'), slug: null });
    expect(proofs()).toEqual([]);
    expect(await j(await resolve(theirs, mallory))).toMatchObject({ ok: false, code: 'PROVE', repos: [] });
    expect(await store.connectorWithSecret('ws_evil', 'github', theirs)).toBeNull();
  });

  it('the public door keeps its branch with the proof on', async () => {
    const r = await app.request('/connect/github/callback?installation_id=555&setup_action=install&state=acme%2Fsite');
    expect(r.headers.get('location')).toContain('/announce?granted=1&repo=acme%2Fsite');
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: null })]);
    expect(calls.some((c) => c.includes('/login/oauth'))).toBe(false);
  });
});

describe('the prove call refuses before it asks GitHub', () => {
  const refused = async (actor: Actor, body: Record<string, unknown>, code: string) => {
    const r = await prove(actor, body);
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ ok: false, code });
  };
  afterEach(() => {
    expect(calls).toEqual([]);
    expect(proofs()).toEqual([]);
    expect(connectors()).toEqual([]);
  });

  it('another account\'s call is OTHER_ACCOUNT, an agent\'s too', async () => {
    const state = await stateFor(room);
    members().get('ws_acme')!.add('mallory');
    await refused(mallory, { code: 'c_mallory', state }, 'OTHER_ACCOUNT');
    await refused(rex, { code: 'c_george', state }, 'OTHER_ACCOUNT');
    expect(await j(await prove(mallory, { code: 'c_mallory', state }))).toMatchObject({ error: 'This grant started for another neuramesh account. Sign in as that account, or start the grant again from your own room.' });
  });

  it('a person who is not a member is NOT_MEMBER, a member who left too', async () => {
    // no door seals a state for a person outside the workspace: the check holds a sealed one anyway
    await refused(walt, { code: 'c_george', state: sealProofState('w', { github: 1, workspace: 'ws_acme', channel: room, actor: 'walt', slug: null }) }, 'NOT_MEMBER');
    const state = await stateFor(room);
    members().get('ws_acme')!.delete('george');
    await refused(george, { code: 'c_george', state }, 'NOT_MEMBER');
  });

  it('a state more than an hour old is EXPIRED', async () => {
    const state = sealProofState('w', { github: 1, workspace: 'ws_acme', channel: room, actor: 'george', slug: null }, Date.now() - 3_601_000);
    await refused(george, { code: 'c_george', state }, 'EXPIRED');
    expect(await j(await prove(george, { code: 'c_george', state }))).toMatchObject({ error: 'This grant is more than an hour old. Start again from neuramesh.' });
  });

  it('a state with no nonce, no iat, no prefix, or a room of another workspace is BAD_STATE', async () => {
    const base = { github: 1 as const, workspace: 'ws_acme', channel: room as string | null, actor: 'george', slug: null };
    await refused(george, { code: 'c_george', state: `w.${seal({ ...base, iat: Math.floor(Date.now() / 1000) })}` }, 'BAD_STATE');
    await refused(george, { code: 'c_george', state: `w.${seal({ ...base, nonce: 'n1' })}` }, 'BAD_STATE');
    await refused(george, { code: 'c_george', state: seal({ ...base, iat: Math.floor(Date.now() / 1000), nonce: 'n1' }) }, 'BAD_STATE');
    await refused(george, { code: 'c_george', state: 'w.garbage' }, 'BAD_STATE');
    await refused(george, { code: 'c_george' }, 'BAD_STATE');
    await refused(george, { code: 'c_george', state: sealProofState('w', { ...base, channel: theirs }) }, 'BAD_STATE');
    await refused(george, { state: await stateFor(room) }, 'BAD_STATE');
  });

  it('GitHub\'s own error ends the grant with its words: DENIED, REQUEST', async () => {
    const state = await stateFor(room);
    await refused(george, { error: 'access_denied', state }, 'DENIED');
    await refused(george, { error: 'request', state }, 'REQUEST');
    expect(await j(await prove(george, { error: 'request', state }))).toMatchObject({ error: 'GitHub sent your request to the owners of the account. When an owner approves it, grant access again from neuramesh.' });
  });

  it('without the client values the call is NOT_CONFIGURED, in the plan\'s words', async () => {
    const state = await stateFor(room);
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');
    await refused(george, { code: 'c_george', state }, 'NOT_CONFIGURED');
    expect(await j(await prove(george, { code: 'c_george', state }))).toEqual({ ok: false, code: 'NOT_CONFIGURED', error: 'neuramesh cannot finish the grant now.' });
  });
});

describe('the proof connects the room', () => {
  it('a body built from the page\'s address, with null or empty for the absent parameters, is read as the contract says', async () => {
    const r = await resolve(room, george, { client: null });
    expect(r.status).toBe(200);
    const state = new URL((await j(r)).authorize).searchParams.get('state')!;
    expect(await j(await prove(george, { code: 'c_george', error: null, state }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    connectors().length = 0;
    expect(await j(await prove(george, { code: '', error: 'access_denied', state }))).toMatchObject({ ok: false, code: 'DENIED' });
  });

  it('the proof covers the room\'s repository: connected with no click, the card resumed as the person, the token deleted', async () => {
    const threadId = crypto.randomUUID();
    await app.request('/v1/messages', { method: 'POST', headers: as(rex), body: JSON.stringify({ workspace: 'ws_acme', channel: room, threadId, needCard: true, body: `I need the code.\n\n${needBlock({ channel: room, ask: 'The audit', why: 'It reads the code.', connect: ['github'] })}` }) });
    const link = new URL((await j(await resolve(room))).authorize);
    const state = link.searchParams.get('state')!;
    // the code is GitHub's answer to this link, so it redeems only with this link's PKCE verifier
    issued['c_george'] = link.searchParams.get('code_challenge');
    expect(await j(await prove(george, { code: 'c_george', state }))).toEqual({ ok: true, outcome: 'connected', handle: 'acme/site', room: 'marketing' });
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toMatchObject({ status: 'connected', handle: 'acme/site', ciphertext: null });
    expect(proofs()).toEqual([expect.objectContaining({ workspace: 'ws_acme', actor: 'george', installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] })]);
    const card = (await store.listDecisions('ws_acme')).find((d) => d.question.startsWith(GITHUB_NEED_PREFIX));
    expect(card).toMatchObject({ status: 'answered', answeredBy: { kind: 'human', id: 'george' } });
    expect(store.messages.filter((m) => m.threadId === threadId && m.body === githubConnectedMarker('acme/site'))).toHaveLength(1);
    // the exchange named the hq page and the link's verifier, and the token went back to GitHub
    expect(exchanges).toEqual([{ client_id: CLIENT_ID, client_secret: SECRET, code: 'c_george', redirect_uri: HQ_CALLBACK, code_verifier: expect.stringMatching(/^[\w-]{43}$/) }]);
    expect(s256(exchanges[0]!['code_verifier']!)).toBe(link.searchParams.get('code_challenge'));
    expect(deletes).toEqual([{ what: 'token', basic: `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`, body: { access_token: 'ghu_george' } }]);
    // the installation's record, from the App's own list, for the room's workspace because it named none (a rollback finds it there)
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: 'ws_acme', repos: ['acme/site', 'acme/docs'] })]);
    expect(await j(await resolve(room))).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });

  it('a reauth_required row of that repository turns connected', async () => {
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: room, provider: 'github', handle: 'acme/site', connectedBy: 'george', scopes: '' });
    await store.markConnectorReauth(id);
    expect((await store.connectorWithSecret('ws_acme', 'github', room))?.status).toBe('reauth_required');
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toMatchObject({ id, status: 'connected' });
  });

  it('a folder project attaches only the proven repository named like the folder', async () => {
    const folder = await folderRoom();
    users['ghu_george']!.sees = { 555: ['acme/site', 'acme/docs'] };
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(folder) }))).toEqual({ ok: true, outcome: 'connected', handle: 'acme/site', room: 'folder' });
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'acme', name: 'site', provider: 'github' });
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toMatchObject({ status: 'connected', handle: 'acme/site' });
  });

  it('a folder whose name two proven repositories share is the pick, and nothing attaches', async () => {
    const folder = await folderRoom();
    installs[777] = { account: 'other', type: 'User', selection: 'selected', repos: ['other/site'] };
    users['ghu_george']!.sees = { 555: ['acme/site'], 777: ['other/site'] };
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(folder) }))).toEqual({ ok: true, outcome: 'pick', repos: ['acme/site', 'other/site'], hint: 'acme/site' });
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
    expect(await store.connectorWithSecret('ws_acme', 'github', folder)).toBeNull();
  });

  it('several repositories and a project that names none: the pick, then the resolve lists the proof and the pick connects', async () => {
    users['ghu_george']!.sees = { 555: ['acme/site', 'acme/docs'] };
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(bare) }))).toEqual({ ok: true, outcome: 'pick', repos: ['acme/docs', 'acme/site'], hint: null });
    expect(await store.connectorWithSecret('ws_acme', 'github', bare)).toBeNull();
    expect(await j(await resolve(bare))).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['acme/docs', 'acme/site'] });
    expect(await j(await resolve(bare, george, { repo: 'acme/docs' }))).toEqual({ ok: true, handle: 'acme/docs', attached: true });
  });

  it('the App reads no installation of the room\'s repository: install with the same state, and nothing read gives install with no repository', async () => {
    installs[555]!.repos = ['acme/docs'];
    users['ghu_george']!.sees = { 555: ['acme/docs'] };
    const state = await stateFor(room);
    expect(await j(await prove(george, { code: 'c_george', state }))).toEqual({ ok: true, outcome: 'install', install: `https://github.com/apps/neuramesh/installations/new?state=${encodeURIComponent(state)}`, slug: 'acme/site' });
    expect(proofs().map((p) => p.repos)).toEqual([['acme/docs']]);
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    users['ghu_george']!.sees = {};
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(bare) }))).toMatchObject({ ok: true, outcome: 'install', slug: null });
  });

  it('the App reads the room\'s repository and the person\'s account has no access to it: NO_ACCESS names the account, and only the token is deleted', async () => {
    // walt is a teammate, and his GitHub account is in no organization that the App reads
    members().get('ws_acme')!.add('walt');
    users['ghu_walt'] = { id: 77, login: 'walt-gh', sees: {} };
    codes['c_walt'] = 'ghu_walt';
    const words = 'Your GitHub account walt-gh has no access to acme/site. Get access from an owner of acme, or use another GitHub account. Then grant access again.';
    expect(await j(await prove(walt, { code: 'c_walt', state: await stateFor(room, walt) }))).toEqual({ ok: false, code: 'NO_ACCESS', error: words, login: 'walt-gh', slug: 'acme/site' });
    expect(deletes.map((d) => d.what)).toEqual(['token']);
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    // the organization is on his list and the room's repository is not: the same answer, never the install page
    users['ghu_walt']!.sees = { 555: ['acme/docs'] };
    expect(await j(await prove(walt, { code: 'c_walt', state: await stateFor(room, walt) }))).toMatchObject({ ok: false, code: 'NO_ACCESS', slug: 'acme/site' });
    // a 403 with no single sign-on in it is no access too
    failing['/repos/acme/site'] = { status: 403, message: 'Forbidden' };
    expect(await j(await prove(walt, { code: 'c_walt', state: await stateFor(room, walt) }))).toMatchObject({ ok: false, code: 'NO_ACCESS' });
    expect(deletes.map((d) => d.what)).toEqual(['token', 'token', 'token']);
  });

  it('GitHub refuses the person\'s own read for single sign-on: SSO with its page, the whole grant deleted, and the next resolve asks for the grant again', async () => {
    installs[777] = { account: 'george-gh', type: 'User', selection: 'selected', repos: ['george-gh/notes'] };
    users['ghu_george'] = { id: 11, login: 'george-gh', sees: { 777: ['george-gh/notes'] }, sso: ['acme'] };
    const r = await j(await prove(george, { code: 'c_george', state: await stateFor(room) }));
    expect(r).toEqual({ ok: false, code: 'SSO', error: 'The organization acme uses single sign-on. Sign in to it on GitHub, then grant access again.', sso: 'https://github.com/orgs/acme/sso' });
    expect(deletes.map((d) => d.what)).toEqual(['grant']);
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    // the fresh proof holds his own repository only: the authorize page is the next move, never the install page
    expect(await j(await resolve(room))).toMatchObject({ ok: false, code: 'PROVE', repos: ['george-gh/notes'], authorize: expect.stringContaining('https://github.com/login/oauth/authorize?') });
    // a 403 that names SAML in its words, with no header, is single sign-on too
    users['ghu_george']!.sso = [];
    failing['/repos/acme/site'] = { status: 403, message: 'Resource protected by organization SAML enforcement.' };
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toMatchObject({ ok: false, code: 'SSO' });
  });

  it('single sign-on on an installation whose answer names no organization login: the plain words, and no link', async () => {
    installs[555]!.account = '';
    users['ghu_george'] = { id: 11, login: 'george-gh', sees: {}, sso: ['acme'] };
    const words = 'Your organization on GitHub uses single sign-on. Sign in to it on GitHub, then grant access again.';
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toEqual({ ok: false, code: 'SSO', error: words });
    expect(deletes.map((d) => d.what)).toEqual(['grant']);
  });

  it('a code from one grant\'s link redeems with no other grant\'s state (PKCE)', async () => {
    // mallory's room names acme/site too (a link takes any address)
    store.announcements.seedRepo({ channelId: theirs, workspaceId: 'ws_evil', projectId: 'pE', repoId: 'rE', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
    const link = new URL((await j(await resolve(room))).authorize);
    issued['c_george'] = link.searchParams.get('code_challenge');
    // george's code leaks (an app that claims the neuramesh scheme on a phone), and mallory sends it with her own state
    expect(await j(await prove(mallory, { code: 'c_george', state: await stateFor(theirs, mallory) }))).toEqual({ ok: false, code: 'CODE_REFUSED', error: 'GitHub did not accept this grant. Start again from neuramesh.' });
    expect(proofs()).toEqual([]);
    expect(await store.connectorWithSecret('ws_evil', 'github', theirs)).toBeNull();
    expect(link.searchParams.get('code_challenge_method')).toBe('S256');
    expect(link.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    // the code's own state redeems it
    expect(await j(await prove(george, { code: 'c_george', state: link.searchParams.get('state')! }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
  });

  it('a narrower person\'s proof leaves the installation\'s record whole, so a connected room reads with no GitHub lookup', async () => {
    members().get('ws_acme')!.add('walt');
    users['ghu_walt'] = { id: 77, login: 'walt-gh', sees: { 555: ['acme/docs'] } };
    codes['c_walt'] = 'ghu_walt';
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    // walt's account reads acme/docs alone of the same installation
    expect(await j(await prove(walt, { code: 'c_walt', state: await stateFor(bare, walt) }))).toMatchObject({ ok: true, outcome: 'pick', repos: ['acme/docs'] });
    // the App's lookup of the repository's installation fails once, and george's room still reads
    failing['/repos/acme/site/installation'] = { status: 502 };
    const read = await app.request(`/v1/repo/tree?channel=${room}`, { headers: as(george) });
    expect(read.status).toBe(200);
    expect((await store.connectorWithSecret('ws_acme', 'github', room))?.status).toBe('connected');
    // the record is the installation's own list, as the App reads it
    expect(store.announcements.installations.map((i) => [i.installationId, [...i.repos].sort()])).toEqual([[555, ['acme/docs', 'acme/site']]]);
  });
});

describe('the resolve with the proof on', () => {
  it('the old installation record gives no new connect, and the person\'s fresh proof gives the pick with the room\'s repository chosen', async () => {
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_acme' });
    expect(await j(await resolve(room))).toMatchObject({ ok: false, code: 'PROVE', repos: [], error: 'GitHub must confirm which repositories your account can read. Grant access on GitHub.' });
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    // the record is not even read for a token: only a proof names an installation
    expect(calls).toEqual([]);
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] }]);
    expect(await j(await resolve(room))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: 'Connect acme/site to this room.', repos: ['acme/site'], hint: 'acme/site', authorize: expect.stringContaining('https://github.com/login/oauth/authorize?') });
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toBeNull();
    expect(await j(await resolve(room, george, { repo: 'acme/site' }))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect(await store.connectorWithSecret('ws_acme', 'github', room)).toMatchObject({ status: 'connected', handle: 'acme/site' });
  });

  it('an ask that nobody clicked connects nothing: a teammate\'s room that names a repository the person proved', async () => {
    // walt's room names acme/site and asks for GitHub with a card. george proved acme/site this morning
    members().get('ws_acme')!.add('walt');
    const theirRoom = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p5', slug: 'walts', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
    store.announcements.seedRepo({ channelId: theirRoom, workspaceId: 'ws_acme', projectId: 'p5', repoId: 'r5', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
    const threadId = crypto.randomUUID();
    await app.request('/v1/messages', { method: 'POST', headers: as(rex), body: JSON.stringify({ workspace: 'ws_acme', channel: theirRoom, threadId, needCard: true, body: `I need the code.\n\n${needBlock({ channel: theirRoom, ask: 'The audit', why: 'It reads the code.', connect: ['github'] })}` }) });
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] }]);
    // george opens the thread: the card's mount ask, then the poll
    for (let i = 0; i < 2; i++) expect(await j(await resolve(theirRoom))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', hint: 'acme/site' });
    expect(await store.connectorWithSecret('ws_acme', 'github', theirRoom)).toBeNull();
    expect((await store.listDecisions('ws_acme')).find((d) => d.question.startsWith(GITHUB_NEED_PREFIX))).toMatchObject({ status: 'open' });
    // his click on Connect is the act that lends his access: the room connects, and the card resumes as george
    expect(await j(await resolve(theirRoom, george, { repo: 'acme/site' }))).toEqual({ ok: true, handle: 'acme/site', attached: false });
    expect((await store.listDecisions('ws_acme')).find((d) => d.question.startsWith(GITHUB_NEED_PREFIX))).toMatchObject({ status: 'answered', answeredBy: { kind: 'human', id: 'george' } });
    // the room holds it now: the next ask answers connected, for any member
    expect(await j(await resolve(theirRoom, walt))).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });

  it('a project that names its repository with capitals: the pick from the lowercased list connects it and attaches nothing', async () => {
    const caps = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p6', slug: 'caps', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
    store.announcements.seedRepo({ channelId: caps, workspaceId: 'ws_acme', projectId: 'p6', repoId: 'r6', orgName: 'Acme', name: 'Site', cloneUrl: 'https://github.com/Acme/Site.git', provider: 'github' });
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] }]);
    expect(await j(await resolve(caps))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', repos: ['acme/site'], hint: 'acme/site' });
    expect(await j(await resolve(caps, george, { repo: 'acme/site' }))).toEqual({ ok: true, handle: 'Acme/Site', attached: false });
    expect(await store.announcements.repoForChannel(caps)).toMatchObject({ orgName: 'Acme', name: 'Site' });
  });

  it('a proof counts for 24 hours, for its own person, while the person is a member', async () => {
    members().get('ws_acme')!.add('walt');
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001, 1002], repos: ['acme/site', 'acme/docs'] }]);
    // another member's resolve: the pick lists only that person's own proven repositories
    expect(await j(await resolve(bare, walt))).toMatchObject({ ok: false, code: 'PROVE', repos: [] });
    proofs()[0]!.provenAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(await j(await resolve(bare))).toMatchObject({ ok: false, code: 'PROVE', repos: [] });
    proofs()[0]!.provenAt = new Date().toISOString();
    expect(await j(await resolve(bare))).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['acme/docs', 'acme/site'] });
    members().get('ws_acme')!.delete('george');
    expect(await store.githubProofs.fresh('ws_acme', 'george')).toEqual([]);
  });

  it('a name GitHub gave to another repository since is not the one proven, and a pick outside the proof is refused', async () => {
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1001], repos: ['acme/site'] }]);
    ids['acme/site'] = 4242;
    expect(await j(await resolve(room))).toMatchObject({ ok: false, code: 'PROVE' });
    expect(await j(await resolve(bare, george, { repo: 'acme/docs' }))).toMatchObject({ ok: false, code: 'NOT_INSTALLED', error: 'The neuramesh app cannot read acme/docs. Add the repository on GitHub, then pick it.' });
    expect(connectors()).toEqual([]);
  });

  it('a fresh proof that does not hold the room\'s repository sends the person to the authorize page again', async () => {
    // george proved this morning, when his account read acme/docs alone through the App
    await store.githubProofs.replace('ws_acme', 'george', [{ installationId: 555, githubUserId: 11, githubLogin: 'george-gh', repoIds: [1002], repos: ['acme/docs'] }]);
    const r = await j(await resolve(room));
    expect(r).toMatchObject({ ok: false, code: 'PROVE', error: 'GitHub must confirm that your account can read acme/site. Grant access on GitHub.', repos: ['acme/docs'] });
    const link = new URL(r.authorize);
    expect(link.origin + link.pathname).toBe('https://github.com/login/oauth/authorize');
    // since then he reads acme/site: the grant connects it
    expect(await j(await prove(george, { code: 'c_george', state: link.searchParams.get('state')! }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
  });

  it('a connection the room holds keeps answering connected with no proof', async () => {
    await store.upsertConnector({ workspace: 'ws_acme', channelId: room, provider: 'github', handle: 'acme/site', connectedBy: 'george', scopes: '' });
    expect(await j(await resolve(room))).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });
});

describe('the rollback: the client values removed', () => {
  const off = (): void => { vi.stubEnv('GITHUB_APP_CLIENT_ID', ''); vi.stubEnv('GITHUB_APP_CLIENT_SECRET', ''); };
  /** a room of another project that names acme/docs, which installation 555 reads too */
  const docsRoom = async (): Promise<string> => {
    const id = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p7', slug: 'docs', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
    store.announcements.seedRepo({ channelId: id, workspaceId: 'ws_acme', projectId: 'p7', repoId: 'r7', orgName: 'acme', name: 'docs', cloneUrl: 'https://github.com/acme/docs.git', provider: 'github' });
    return id;
  };

  it('an installation that a proof connected names the room\'s workspace, so the old resolve finds it in the workspace\'s other rooms', async () => {
    // the App went onto acme while the proof was on: the Setup URL hop recorded nothing, and the prove call connects the room
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    off();
    expect(await j(await resolve(await docsRoom()))).toEqual({ ok: true, handle: 'acme/docs', attached: false });
    expect(await j(await resolve(bare))).toMatchObject({ ok: false, code: 'NO_REPO', repos: ['acme/docs', 'acme/site'] });
  });

  it('a pick records the installation the same way', async () => {
    users['ghu_george']!.sees = { 555: ['acme/site', 'acme/docs'] };
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(bare) }))).toMatchObject({ ok: true, outcome: 'pick' });
    expect(await j(await resolve(bare, george, { repo: 'acme/docs' }))).toEqual({ ok: true, handle: 'acme/docs', attached: true });
    off();
    expect(await j(await resolve(room))).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });

  it('a record that names another workspace keeps it: a proof never moves an installation', async () => {
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site'], selection: 'selected', workspaceId: 'ws_evil' });
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(room) }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(store.announcements.installations).toEqual([expect.objectContaining({ installationId: 555, workspaceId: 'ws_evil', repos: ['acme/site', 'acme/docs'] })]);
  });
});

describe('GitHub\'s answers', () => {
  const answer = async (code: string) => j(await prove(george, { code, state: await stateFor(room) }));

  it('an unverified email is EMAIL, a used code is CODE_REFUSED, and nothing is written', async () => {
    codes['c_email'] = { error: 'unverified_user_email' };
    expect(await answer('c_email')).toEqual({ ok: false, code: 'EMAIL', error: 'GitHub needs a verified email on your account. Verify your primary email on GitHub, then grant access again.' });
    expect(await answer('c_used')).toEqual({ ok: false, code: 'CODE_REFUSED', error: 'GitHub did not accept this grant. Start again from neuramesh.' });
    expect(proofs()).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('a 503, a rate limit, a 429 and a dead network are GITHUB_DOWN, and nothing changes', async () => {
    codes['c_503'] = { status: 503 };
    expect(await answer('c_503')).toMatchObject({ ok: false, code: 'GITHUB_DOWN', error: 'GitHub did not answer. Nothing changed. Try again in a few minutes.' });
    failing['/user/installations'] = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
    expect(await answer('c_george')).toMatchObject({ code: 'GITHUB_DOWN' });
    failing['/user/installations'] = { status: 429, headers: { 'retry-after': '60' } };
    expect(await answer('c_george')).toMatchObject({ code: 'GITHUB_DOWN' });
    failing = { '/user/installations/555/repositories': { status: 502 } };
    expect(await answer('c_george')).toMatchObject({ code: 'GITHUB_DOWN' });
    failing = {};
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const offline = createApp(store, { announce: { fetchFn: down as unknown as typeof fetch } });
    const state = await stateFor(room);
    expect(await j(await offline.request('/v1/github/prove', { method: 'POST', headers: as(george), body: JSON.stringify({ code: 'c_george', state }) }))).toMatchObject({ code: 'GITHUB_DOWN' });
    expect(proofs()).toEqual([]);
    expect(connectors()).toEqual([]);
    // every token that GitHub gave went back to it
    expect(deletes.map((d) => d.what)).toEqual(['token', 'token', 'token']);
  });

  it('a dead network on the connect\'s own read is GITHUB_DOWN too, and nothing but the facts is written', async () => {
    dead.add('/repos/acme/site installation');
    expect(await answer('c_george')).toMatchObject({ ok: false, code: 'GITHUB_DOWN' });
    expect(proofs()).toEqual([]);
    expect(connectors()).toEqual([]);
    expect(deletes.map((d) => d.what)).toEqual(['token']);
  });

  it('the App\'s wrong client values are MISCONFIGURED, with one loud line that names the fix', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    codes['c_creds'] = { error: 'incorrect_client_credentials' };
    expect(await answer('c_creds')).toEqual({ ok: false, code: 'MISCONFIGURED', error: 'neuramesh cannot finish the grant now.' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('incorrect_client_credentials');
    expect(String(error.mock.calls[0]![0])).toContain('GITHUB_APP_CLIENT_SECRET');
    codes['c_redirect'] = { error: 'redirect_uri_mismatch' };
    expect(await answer('c_redirect')).toMatchObject({ code: 'MISCONFIGURED' });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('pagination past 100: the installations and the repositories on their second pages', async () => {
    // GitHub lists in id order here: a hundred suspended installations first, then acme's on page 2
    const filler = Array.from({ length: 100 }, (_, i) => 100 + i);
    for (const id of filler) installs[id] = { account: `org${id}`, type: 'Organization', selection: 'selected', repos: [`org${id}/r`], suspended: true };
    const many = Array.from({ length: 149 }, (_, i) => `acme/r${i}`);
    installs[555]!.repos = [...many, 'acme/site'];
    users['ghu_george']!.sees = { ...Object.fromEntries(filler.map((id) => [id, [`org${id}/r`]])), 555: [...many, 'acme/site'] };
    expect(await answer('c_george')).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(calls).toContain('GET /user/installations?per_page=100&page=2 user');
    expect(calls).toContain('GET /user/installations/555/repositories?per_page=100&page=2 user');
    // a suspended installation reads nothing: no list was asked for one
    expect(calls.some((c) => c.startsWith('GET /user/installations/100/'))).toBe(false);
    expect(proofs()[0]!.repos).toHaveLength(150);
  });

  it('a large account: past the caps, the room\'s own repository is read directly, and a public one proves nothing', async () => {
    // 31 installations that each take one page use up the budget before acme's, which GitHub lists last
    const many = Array.from({ length: 31 }, (_, i) => 100 + i);
    for (const id of many) installs[id] = { account: `org${id}`, type: 'Organization', selection: 'selected', repos: [`org${id}/r`] };
    users['ghu_george']!.sees = { ...Object.fromEntries(many.map((id) => [id, [`org${id}/r`]])), 555: ['acme/site'] };
    users['ghu_george']!.direct = { 'acme/site': true };
    expect(await answer('c_george')).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(calls).toContain('GET /repos/acme/site user');
    expect(proofs().find((p) => p.installationId === 555)).toMatchObject({ repoIds: [1001], repos: ['acme/site'] });
    connectors().length = 0;
    store.githubProofs.rows.length = 0;
    // a public repository with no role beyond read: the App reads it, and the person's account has no access to it
    users['ghu_george']!.direct = { 'acme/site': false };
    expect(await answer('c_george')).toMatchObject({ ok: false, code: 'NO_ACCESS', slug: 'acme/site' });
    expect(connectors()).toEqual([]);
  });

  it('a 404 on one installation\'s list drops that installation only, and the person\'s own read still proves the room\'s repository', async () => {
    installs[777] = { account: 'gone', type: 'User', selection: 'selected', repos: ['gone/x'] };
    users['ghu_george']!.sees = { 777: ['gone/x'], 555: ['acme/site'] };
    failing['/user/installations/777/repositories'] = { status: 404 };
    expect(await answer('c_george')).toMatchObject({ ok: true, outcome: 'connected' });
    expect(proofs().map((p) => p.installationId)).toEqual([555]);
    // the room's own installation's list answers 404: the person's own read of the private repository proves it
    connectors().length = 0;
    store.githubProofs.rows.length = 0;
    failing['/user/installations/555/repositories'] = { status: 404 };
    expect(await answer('c_george')).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(proofs().map((p) => [p.installationId, p.repos])).toEqual([[555, ['acme/site']]]);
  });
});

describe('GitHub busy or down on the connect step', () => {
  const down = { ok: false, code: 'GITHUB_DOWN', error: 'GitHub did not answer. Nothing changed. Try again in a few minutes.' };
  const answer = async (ch: string = room) => j(await prove(george, { code: 'c_george', state: await stateFor(ch) }));
  /** GitHub never answers this path in time: the request's own timeout fires */
  const slow = (path: string): void => {
    app = createApp(store, { announce: { fetchFn: async (input, init) => {
      if (new URL(String(input)).pathname === path) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return github(input, init);
    } } });
  };
  /** GitHub answers this path once, then `fail`: the App's own lookup in holds() meets an outage that the person's step did not */
  const later = (path: string, fail: { status: number; headers?: Record<string, string> }): void => {
    let asked = 0;
    app = createApp(store, { announce: { fetchFn: async (input, init) => (new URL(String(input)).pathname === path && asked++ > 0
      ? new Response(JSON.stringify({ message: 'busy' }), { status: fail.status, headers: { 'content-type': 'application/json', ...fail.headers } })
      : github(input, init)) } });
  };
  /** the rows a test holds before the outage */
  let seeded: { connectors: unknown[]; installations: unknown[] };
  beforeEach(() => { seeded = { connectors: [], installations: [] }; });
  /** walt's account reads acme/docs alone, and george's room holds acme/site: with GitHub up, walt's grant answers connected (holds()) */
  const heldRoom = async (): Promise<() => Promise<any>> => {
    members().get('ws_acme')!.add('walt');
    users['ghu_walt'] = { id: 77, login: 'walt-gh', sees: { 555: ['acme/docs'] } };
    codes['c_walt'] = 'ghu_walt';
    const state = await stateFor(room, walt);   // before the room holds the connection, so the resolve asks GitHub nothing
    await store.upsertConnector({ workspace: 'ws_acme', channelId: room, provider: 'github', handle: 'acme/site', connectedBy: 'george', scopes: '' });
    seeded.connectors = structuredClone(connectors());
    return async () => j(await prove(walt, { code: 'c_walt', state }));
  };
  // nothing changed: no proof row, no new connector row or installation facts, and every user token went back to GitHub
  afterEach(() => {
    expect(proofs()).toEqual([]);
    expect(connectors()).toEqual(seeded.connectors);
    expect(store.announcements.installations).toEqual(seeded.installations);
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes.every((d) => d.what === 'token')).toBe(true);
  });

  it('a 503 on the App\'s own read of the room\'s repository, and a folder\'s namesake attaches nothing', async () => {
    failing['/repos/acme/site'] = { status: 503 };
    expect(await answer()).toEqual(down);
    const folder = await folderRoom();
    expect(await answer(folder)).toEqual(down);
    expect(await store.announcements.repoForChannel(folder)).toMatchObject({ orgName: 'local' });
  });

  it('a 503, a rate limit or a timeout when the App asks GitHub for its token', async () => {
    failing['/app/installations/555/access_tokens'] = { status: 503 };
    expect(await answer()).toEqual(down);
    failing['/app/installations/555/access_tokens'] = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
    expect(await answer()).toEqual(down);
    failing = {};
    slow('/app/installations/555/access_tokens');
    expect(await answer()).toEqual(down);
  });

  it('a rate limit on the App\'s own read: a 403 with no calls left, a 403 with a retry-after, a 429', async () => {
    const limits: Array<(typeof failing)[string]> = [{ status: 403, headers: { 'x-ratelimit-remaining': '0' } }, { status: 403, headers: { 'retry-after': '60' } }, { status: 429 }];
    for (const fail of limits) {
      failing['/repos/acme/site'] = fail;
      expect(await answer()).toEqual(down);
    }
  });

  it('a 503 or a timeout on the App\'s own lookup of the repository\'s installation, never the install page', async () => {
    // george's account does not list acme/site, so the App's lookup decides between the install page and NO_ACCESS
    users['ghu_george']!.sees = { 555: ['acme/docs'] };
    failing['/repos/acme/site/installation'] = { status: 503 };
    expect(await answer()).toEqual(down);
    failing = {};
    slow('/repos/acme/site/installation');
    expect(await answer()).toEqual(down);
  });

  it('the room holds a connection and the person has no access: GitHub busy on the App\'s token or read in holds()', async () => {
    const walts = await heldRoom();
    expect(await walts()).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    store.githubProofs.rows.length = 0;
    forgetToken(555);
    const limit = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
    for (const fail of [{ status: 503 }, limit]) {
      failing = { '/app/installations/555/access_tokens': fail };
      expect(await walts()).toEqual(down);
    }
    failing = {};
    dead.add('/app/installations/555/access_tokens app');
    expect(await walts()).toEqual(down);
    dead.clear();
    // the person's own read of the repository answers 404, and only the App's read is busy
    for (const fail of [{ status: 503 }, limit, { status: 403, headers: { 'retry-after': '60' } }, { status: 429 }]) {
      failing = { '/repos/acme/site installation': fail };
      expect(await walts()).toEqual(down);
    }
    failing = {};
    dead.add('/repos/acme/site installation');
    expect(await walts()).toEqual(down);
  });

  it('the room holds a connection and the person has no access: GitHub busy on the lookup in holds(), or on the token of an installation on record', async () => {
    const walts = await heldRoom();
    for (const fail of [{ status: 503 }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }]) {
      later('/repos/acme/site/installation', fail);
      expect(await walts()).toEqual(down);
    }
    app = createApp(store, { announce: { fetchFn: github } });
    await store.announcements.upsertInstallation({ installationId: 555, account: 'acme', repos: ['acme/site', 'acme/docs'], selection: 'selected', workspaceId: 'ws_acme' });
    seeded.installations = structuredClone(store.announcements.installations);
    failing['/app/installations/555/access_tokens'] = { status: 503 };
    expect(await walts()).toEqual(down);
  });
});

describe('the token stays out', () => {
  it('no log line, row or answer holds the token, the code or the secret', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const [roomState, bareState] = [await stateFor(room), await stateFor(bare)];
    const answers: any[] = [];
    users['ghu_george']!.sees = {};
    users['ghu_george']!.sso = ['acme'];
    answers.push(await j(await prove(george, { code: 'c_george', state: roomState })));   // SSO: GitHub refuses his read for acme's sign-on
    users['ghu_george']!.sso = [];
    answers.push(await j(await prove(george, { code: 'c_george', state: bareState })));   // install: nothing read
    codes['c_creds'] = { error: 'incorrect_client_credentials' };
    answers.push(await j(await prove(george, { code: 'c_creds', state: roomState })));
    failing['/user'] = { status: 500 };
    answers.push(await j(await prove(george, { code: 'c_george', state: roomState })));
    failing = {};
    users['ghu_george']!.sees = { 555: ['acme/site'] };
    answers.push(await j(await prove(george, { code: 'c_george', state: roomState })));
    expect(answers.map((a) => a.code ?? a.outcome)).toEqual(['SSO', 'install', 'MISCONFIGURED', 'GITHUB_DOWN', 'connected']);
    const seen = JSON.stringify({ lines, answers, proofs: proofs(), installations: store.announcements.installations, connectors: connectors() });
    for (const secret of ['ghu_george', 'c_george', 'c_creds', SECRET]) expect(seen).not.toContain(secret);
    expect(lines.length).toBeGreaterThan(0);   // the loud line ran, and it holds none of them
  });
});

describe('the writes order', () => {
  it('a resolve between the writes never shows a pick for a room the call connects', async () => {
    const folder = await folderRoom();
    users['ghu_george']!.sees = { 555: ['acme/site', 'acme/docs'] };
    const seen: any[] = [];
    let probing = false;
    const between = async () => { if (probing) return; probing = true; seen.push(await j(await resolve(folder))); probing = false; };
    const wrap = <T extends object, K extends keyof T>(o: T, k: K) => {
      const orig = (o[k] as (...a: unknown[]) => Promise<unknown>).bind(o);
      (o as Record<K, unknown>)[k] = async (...a: unknown[]) => { await between(); return orig(...a); };
    };
    wrap(store, 'linkRepo');
    wrap(store, 'upsertConnector');
    wrap(store.githubProofs, 'replace');
    expect(await j(await prove(george, { code: 'c_george', state: await stateFor(folder) }))).toMatchObject({ ok: true, outcome: 'connected', handle: 'acme/site' });
    expect(seen).toHaveLength(3);
    for (const r of seen) expect(r.ok === true || (r.code === 'PROVE' && r.repos.length === 0)).toBe(true);
    expect(seen.at(-1)).toEqual({ ok: true, handle: 'acme/site', attached: false });
  });
});
