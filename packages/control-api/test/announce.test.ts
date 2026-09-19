// The public door (docs/design/release-drafts-2026-09 §4.8): the detect, the queue and its caps,
// the page's read, the cron job with every outside call faked, the image, and the claim.
import type { Actor } from '@neuramesh/shared';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';
import type { AnnounceDeps } from '../src/announce-job';

const george: Actor = { kind: 'human', id: 'george' };
const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const RELEASE = { tag_name: 'v1.2.0', name: 'The shared inbox', body: 'One thread per customer.', published_at: '2026-09-16T15:00:00Z', html_url: 'https://github.com/o/r/releases/tag/v1.2.0', draft: false, prerelease: false };
const PULLS = [
  { number: 41, title: 'The shared inbox', body: '', labels: [], merged_at: '2026-09-16T10:00:00Z', html_url: 'https://github.com/o/r/pull/41', user: { login: 'galonge' } },
  { number: 42, title: 'chore: bump deps', body: '', labels: [], merged_at: '2026-09-16T11:00:00Z', html_url: 'https://github.com/o/r/pull/42', user: { login: 'dependabot[bot]' } },
  { number: 43, title: 'Old work', body: '', labels: [], merged_at: '2026-09-01T11:00:00Z', html_url: 'https://github.com/o/r/pull/43', user: { login: 'galonge' } },
];
/** GitHub, answered from fixtures: o/r is public, o/p is private (a 404 to a stranger) */
const github: typeof fetch = async (input) => {
  const url = String(input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/repos/o/r')) return json({ private: false, homepage: 'https://o.dev', default_branch: 'main', description: 'r' });
  if (url.includes('/repos/o/r/releases')) return json([RELEASE]);
  if (url.includes('/repos/o/r/pulls')) return json(PULLS);
  if (url.endsWith('/repos/o/p')) return json({ message: 'Not Found' }, 404);
  return json({ message: 'Not Found' }, 404);
};

const ANSWER = JSON.stringify({
  verdict: 'feature', title: 'The shared inbox: one thread per customer', why: 'The notes lead with it and #41 builds it.', audience: 'Support teams.', assets: 'A release card.', gaps: 'Nothing.',
  posts: [
    { platform: 'x', body: 'v1.2.0 is out. One thread per customer, replies drafted for you.' },
    { platform: 'linkedin', body: 'v1.2.0 adds a shared inbox.\n\nOne thread per customer.\n\nRead more on the release.' },
    { platform: 'instagram', body: 'The shared inbox is here. v1.2.0.', imageBrief: 'the release card' },
  ],
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let mails: Array<{ to: string; subject: string }>;
let deps: Partial<AnnounceDeps>;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asHuman = (actor: Actor) => ({ 'x-nm-actor': JSON.stringify(actor) });

beforeEach(() => {
  store = new MemoryStore();
  mails = [];
  deps = {
    read: async () => ({ releases: [{ tag: 'v1.2.0', name: 'The shared inbox', body: 'One thread per customer.', publishedAt: '2026-09-16T15:00:00Z', url: null }], prs: [{ number: 41, title: 'The shared inbox', mergedAt: '2026-09-16T10:00:00Z', labels: [], url: null, author: 'galonge' }], tags: [], repo: { private: false, homepage: 'https://o.dev', defaultBranch: 'main', description: null } }),
    token: async () => null,
    site: async () => ({ url: 'https://o.dev', title: 'Odev · support software', description: 'Support, calmly.', palette: ['#161616', '#834a2b', '#f5f4f2'], tokens: {}, fonts: ['Geist'], voice: 'Support, calmly. One inbox.', logo: null, cssUrls: [] }),
    brain: async () => ANSWER,
    card: async () => PNG,
    mail: async (row, email) => { mails.push({ to: row.email, subject: email.subject }); },
  };
  app = createApp(store, { announce: { deps, fetchFn: github } });
  process.env['CRON_SECRET'] = 'cron-test';
});
afterEach(() => { delete process.env['CRON_SECRET']; delete process.env['ANNOUNCE_EMAIL_CAP']; });

describe('POST /announce/detect', () => {
  it('a public repository: the latest release, the merged pull requests since it, the homepage', async () => {
    const r = await j(await post('/announce/detect', { repo: 'github.com/o/r' }));
    expect(r).toMatchObject({ ok: true, slug: 'o/r', private: false, installed: true, latest: { tag: 'v1.2.0', name: 'The shared inbox' }, prs: 0, homepage: 'https://o.dev', install: null });
  });
  it('a private or missing repository says both, with no install link while the App is unconfigured', async () => {
    const r = await j(await post('/announce/detect', { repo: 'o/p' }));
    expect(r).toEqual({ ok: true, slug: 'o/p', private: true, installed: false, latest: null, prs: 0, homepage: null, install: null });
  });
  it('a paste that is not a repository', async () => {
    expect(await j(await post('/announce/detect', { repo: 'not a repo' }))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('the private path with the App configured (the live install, 2026-09-18)', () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const calls: string[] = [];
  /** GitHub: o/p is private; the App holds installation 162852885 on it and its token reads it */
  const github: typeof fetch = async (input, init) => {
    const url = String(input);
    const auth = String(new Headers(init?.headers).get('authorization') ?? '');
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${auth.startsWith('Bearer ghs_') ? 'installation' : auth.startsWith('Bearer ') ? 'app' : 'anon'}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/repos/o/p/installation')) return json({ id: 162852885, account: { login: 'o' } });
    if (url.endsWith('/app/installations/162852885/access_tokens')) return json({ token: 'ghs_test', expires_at: '2026-09-18T22:00:00Z' }, 201);
    if (url.endsWith('/installation/repositories?per_page=100')) return json({ repositories: [{ full_name: 'o/p' }, { full_name: 'o/q' }] });
    if (url.endsWith('/repos/o/p')) return auth === 'Bearer ghs_test' ? json({ private: true, homepage: null }) : json({ message: 'Not Found' }, 404);
    if (url.includes('/repos/o/p/releases')) return json([RELEASE]);
    if (url.includes('/repos/o/p/pulls')) return json([]);
    return json({ message: 'Not Found' }, 404);
  };
  beforeEach(() => {
    vi.stubEnv('GITHUB_APP_ID', '4994365');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', Buffer.from(pem).toString('base64'));
    calls.length = 0;
    deps.read = async (slug, _since, opts) => { calls.push(`read ${slug} ${opts.token ?? 'anon'}`); return { releases: [{ tag: 'v1.2.0', name: 'The shared inbox', body: '', publishedAt: '2026-09-16T15:00:00Z', url: null }], prs: [], tags: [], repo: { private: true, homepage: null, defaultBranch: 'main', description: null } }; };
    deps.token = async (id) => `ghs_for_${id}`;
    app = createApp(store, { announce: { deps, fetchFn: github } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  it('detect finds the installation on GitHub when the callback never wrote a row, and remembers it', async () => {
    const r = await j(await post('/announce/detect', { repo: 'o/p' }));
    expect(r).toMatchObject({ ok: true, slug: 'o/p', private: true, installed: true, latest: { tag: 'v1.2.0' }, install: null });
    expect(await store.announcements.installationForRepo('o/q')).toEqual({ installationId: 162852885 });
  });
  it('create carries the installation to the job, so the read goes through the App and never anonymously', async () => {
    const { id } = await j(await post('/announce', { repo: 'o/p', website: 'o.dev', email: 'maya@o.dev' }));
    const run = await j(await app.request('/internal/announce-due', { headers: { authorization: 'Bearer cron-test' } }));
    expect(run.processed).toBe(1);
    const view = await j(await app.request(`/announce/${id}`));
    expect(view.status).toBe('ready');
    expect(calls).toContain('read o/p ghs_for_162852885');
  });
  it('a client that names no release gets the latest one resolved, so a second ask serves the first row', async () => {
    const first = await j(await post('/announce', { repo: 'o/p', website: 'o.dev', email: 'maya@o.dev' }));
    const second = await post('/announce', { repo: 'o/p', website: 'o.dev', email: 'maya@o.dev' });
    expect(second.status).toBe(200);
    expect(await j(second)).toMatchObject({ id: first.id });
    expect((await j(await app.request(`/announce/${first.id}`))).tag).toBe('v1.2.0');
  });
  it('the grant callback is the App route, not the social connectors\' 501', async () => {
    const r = await app.request('/connect/github/callback?installation_id=162852885&setup_action=install&state=o%2Fp');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('/announce?granted=1');
    expect(await store.announcements.installationForRepo('o/q')).toEqual({ installationId: 162852885 });
  });
});

describe('POST /announce', () => {
  it('queues a row, serves the same row for the same release and email, refuses a bad email', async () => {
    const a = await post('/announce', { repo: 'o/r', tag: 'v1.2.0', website: 'o.dev', email: 'Maya@o.dev' });
    expect(a.status).toBe(202);
    const { id } = await j(a);
    const b = await j(await post('/announce', { repo: 'https://github.com/o/r', tag: 'v1.2.0', website: 'o.dev', email: 'maya@o.dev' }));
    expect(b.id).toBe(id);
    expect((await post('/announce', { repo: 'o/r', website: 'o.dev', email: 'nope' })).status).toBe(422);
    expect((await post('/announce', { repo: 'o/r', website: 'not a site', email: 'a@b.co' })).status).toBe(422);
  });
  it('the per-email cap holds', async () => {
    process.env['ANNOUNCE_EMAIL_CAP'] = '2';
    expect((await post('/announce', { repo: 'o/r', tag: 'v1', website: 'o.dev', email: 'a@b.co' })).status).toBe(202);
    expect((await post('/announce', { repo: 'o/r', tag: 'v2', website: 'o.dev', email: 'a@b.co' })).status).toBe(202);
    const third = await post('/announce', { repo: 'o/r', tag: 'v3', website: 'o.dev', email: 'a@b.co' });
    expect(third.status).toBe(429);
    expect((await j(third)).error).toMatch(/today/);
  });
});

describe('the cron job, the page, the image, the claim', () => {
  async function queue(): Promise<string> {
    const { id } = await j(await post('/announce', { repo: 'o/r', tag: 'v1.2.0', website: 'o.dev', email: 'maya@o.dev' }));
    return id as string;
  }
  it('needs the cron secret', async () => {
    expect((await app.request('/internal/announce-due')).status).toBe(403);
  });
  it('reads, drafts, draws the card, marks ready and emails the link; the page shows it all', async () => {
    const id = await queue();
    const before = await j(await app.request(`/announce/${id}`));
    expect(before.status).toBe('queued');
    expect(before.email).toBe('m•••@o.dev');
    expect(before.steps).toEqual({ release: 'wait', site: 'wait', drafts: 'next', card: 'next' });
    const run = await j(await app.request('/internal/announce-due', { headers: { authorization: 'Bearer cron-test' } }));
    expect(run.processed).toBe(1);
    expect(run.results[0].status).toBe('ready');
    const after = await j(await app.request(`/announce/${id}`));
    expect(after.status).toBe('ready');
    expect(after.tag).toBe('v1.2.0');
    expect(after.steps).toEqual({ release: 'ready', site: 'ready', drafts: 'ready', card: 'ready' });
    expect(after.brief).toMatchObject({ verdict: 'feature', title: 'The shared inbox: one thread per customer' });
    expect(after.posts.map((p: { platform: string; image: boolean }) => [p.platform, p.image])).toEqual([['x', false], ['linkedin', false], ['instagram', true]]);
    const img = await app.request(`/announce/${id}/image`);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer()).slice(0, 4)).toEqual(PNG.slice(0, 4));
    expect(mails).toEqual([{ to: 'maya@o.dev', subject: expect.stringContaining('v1.2.0') }]);
    // a second tick finds nothing queued
    expect((await j(await app.request('/internal/announce-due', { headers: { authorization: 'Bearer cron-test' } }))).processed).toBe(0);
  });
  it('a brain that answers nothing readable fails the row honestly', async () => {
    deps.brain = async () => 'sorry, no';
    const id = await queue();
    await app.request('/internal/announce-due', { headers: { authorization: 'Bearer cron-test' } });
    const v = await j(await app.request(`/announce/${id}`));
    expect(v.status).toBe('failed');
    expect(v.error).toMatch(/Try again/);
    expect(mails).toEqual([]);
  });
  it('the claim: a person, in their workspace, once the drafts are ready', async () => {
    // membership is what actorInWorkspace reads (humanMemberIds); the memory store keeps it here
    (store as unknown as { wsMembers: Map<string, Set<string>> }).wsMembers.set('ws_acme', new Set(['george']));
    const id = await queue();
    expect((await post(`/v1/announce/${id}/claim`, { workspace: 'ws_acme' }, asHuman(george))).status).toBe(409);
    await app.request('/internal/announce-due', { headers: { authorization: 'Bearer cron-test' } });
    expect((await post(`/v1/announce/${id}/claim`, { workspace: 'ws_acme' }, asHuman(plume))).status).toBe(403);
    expect((await post(`/v1/announce/${id}/claim`, { workspace: 'ws_other' }, asHuman(george))).status).toBe(403);
    const r = await post(`/v1/announce/${id}/claim`, { workspace: 'ws_acme' }, asHuman(george));
    expect(r.status).toBe(200);
    const out = await j(r);
    expect(out.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.channelId).toBeTruthy();
    const items = (store as unknown as { contentItems: Array<{ threadId: string | null; platform: string; channelId: string }> }).contentItems.filter((i) => i.threadId === out.threadId);
    expect(items.map((i) => i.platform)).toEqual(['x', 'linkedin', 'instagram']);
    const channels = (store as unknown as { channels: Array<{ id: string; kind?: string; marketing?: Record<string, unknown> }> }).channels;
    const room = channels.find((c) => c.id === out.channelId)!;
    expect(room.kind).toBe('marketing');
    // the row keeps the host the person typed; the workspace gets a real address (the project's
    // website schema wants a scheme, and the claim went past it on the live harness)
    expect(room.marketing?.['website']).toBe('https://o.dev');
    const again = await j(await post(`/v1/announce/${id}/claim`, { workspace: 'ws_acme' }, asHuman(george)));
    expect(again).toMatchObject({ threadId: out.threadId, already: true });
    const page = await j(await app.request(`/announce/${id}`));
    expect(page.claimed).toBe(true);
  });
});
