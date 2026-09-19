// The GitHub App client behind the public announce door (docs/design/release-drafts-2026-09 §4.8,
// §5.2). What must hold by construction: the App JWT verifies against the App's public key and
// carries the three claims GitHub reads; a pasted repository resolves to one slug or to nothing;
// a read answers with a status instead of a throw, except the one the door must tell apart
// (the repository itself: private-or-missing); the token travels in the request header and
// nowhere else; the webhook signature is timing-safe and an unset secret accepts nothing.
import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubApiError, appJwt, findInstallation, githubAppConfigured, githubGet, installUrl, installationToken,
  parseRepoInput, readRepoSignals, verifyWebhookSignature,
} from '../src/github-app';

// a throwaway App key: GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"), which is what we mirror
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const pemB64 = Buffer.from(pem, 'utf8').toString('base64');

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, number | string>; valid: boolean } {
  const [h, p, s] = jwt.split('.') as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
    valid: verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')),
  };
}

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
type Route = (call: Call) => { status: number; body?: unknown; raw?: string };
/** answers api.github.com paths from fixtures and records every call, headers included */
function fakeFetch(routes: Record<string, Route>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = { url, method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>) }, body: typeof init?.body === 'string' ? init.body : null };
    calls.push(call);
    const route = routes[url.replace('https://api.github.com', '')];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    const r = route(call);
    const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '42' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe('githubAppConfigured: the providerConfigured idiom', () => {
  it('is off until the id and a key are both set', () => {
    expect(githubAppConfigured({})).toBe(false);
    expect(githubAppConfigured({ GITHUB_APP_ID: '77' })).toBe(false);
    expect(githubAppConfigured({ GITHUB_APP_PRIVATE_KEY_B64: pemB64 })).toBe(false);
    expect(githubAppConfigured({ GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY_B64: pemB64 })).toBe(true);
    expect(githubAppConfigured({ GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY: pem })).toBe(true);
  });

  it('reads process.env by default', () => {
    expect(githubAppConfigured()).toBe(false);
    vi.stubEnv('GITHUB_APP_ID', '77');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', pemB64);
    expect(githubAppConfigured()).toBe(true);
  });
});

describe('appJwt: the App identity, RS256 from node:crypto', () => {
  it('verifies against the public key and carries iss, iat and exp', () => {
    const now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const jwt = appJwt({ GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY_B64: pemB64 }, now);
    const { header, payload, valid } = decodeJwt(jwt);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    const iat = Math.floor(now / 1000) - 60;
    expect(payload).toEqual({ iat, exp: iat + 540, iss: '77' });
  });

  it('accepts the PEM itself, PKCS#8 and with \\n escapes (an env editor flattened it)', () => {
    const flat = (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).replace(/\n/g, '\\n');
    const jwt = appJwt({ GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY: flat });
    expect(decodeJwt(jwt).valid).toBe(true);
  });

  it('a tampered payload fails verification', () => {
    const jwt = appJwt({ GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY_B64: pemB64 });
    const [h, , s] = jwt.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ iat: 1, exp: 2, iss: '78' })).toString('base64url');
    expect(decodeJwt(`${h}.${forged}.${s}`).valid).toBe(false);
  });

  it('throws when the App is not configured', () => {
    expect(() => appJwt({})).toThrow(/GITHUB_APP_ID/);
    expect(() => appJwt({ GITHUB_APP_ID: '77' })).toThrow(/GITHUB_APP_ID/);
  });
});

describe('parseRepoInput: five shapes in, one slug out', () => {
  it.each([
    ['acme/widgets', 'acme/widgets'],
    ['github.com/acme/widgets', 'acme/widgets'],
    ['https://github.com/acme/widgets', 'acme/widgets'],
    ['https://github.com/acme/widgets/releases/tag/v1', 'acme/widgets'],
    ['git@github.com:acme/widgets.git', 'acme/widgets'],
    // and the shapes a person pastes without thinking about them
    ['  https://www.github.com/acme/widgets.js/  ', 'acme/widgets.js'],
    ['ssh://git@github.com/acme/widgets.git', 'acme/widgets'],
    ['http://github.com/acme/widgets?tab=readme', 'acme/widgets'],
    ['acme/widgets.git', 'acme/widgets'],
  ])('%s → %s', (input, slug) => {
    expect(parseRepoInput(input)).toEqual({ slug });
  });

  it.each([
    '',
    'acme',
    'acme/wid gets',
    'https://gitlab.com/acme/widgets',
    'gitlab.com/acme',
    'acme/widgets/extra',
    'https://github.com/orgs/acme/repositories',
    'https://github.com/',
    '../..',
  ])('rejects %j', (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});

describe('githubGet: the read, never a throw on a status', () => {
  const headersOf = (calls: Call[]): Record<string, string> => calls[0]!.headers;

  it('sends the GitHub headers and no authorization when nothing is set', async () => {
    const { fetchFn, calls } = fakeFetch({ '/repos/acme/widgets': () => ({ status: 200, body: { id: 1 } }) });
    const r = await githubGet('/repos/acme/widgets', { fetchFn });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: 1 });
    expect(r.headers.get('x-ratelimit-remaining')).toBe('42');
    expect(calls[0]!.method).toBe('GET');
    expect(headersOf(calls)).toEqual({ accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'neuramesh-announce' });
  });

  it('a given token rides as the bearer', async () => {
    const { fetchFn, calls } = fakeFetch({ '/user': () => ({ status: 200, body: {} }) });
    await githubGet('/user', { fetchFn, token: 'ghs_abc' });
    expect(headersOf(calls)['authorization']).toBe('Bearer ghs_abc');
  });

  it('GITHUB_READ_TOKEN is the fallback bearer, and a given token beats it', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_read');
    const a = fakeFetch({ '/user': () => ({ status: 200, body: {} }) });
    await githubGet('/user', { fetchFn: a.fetchFn });
    expect(headersOf(a.calls)['authorization']).toBe('Bearer ghp_read');
    const b = fakeFetch({ '/user': () => ({ status: 200, body: {} }) });
    await githubGet('/user', { fetchFn: b.fetchFn, token: 'ghs_abc' });
    expect(headersOf(b.calls)['authorization']).toBe('Bearer ghs_abc');
    // null means "no token of my own": the env token still applies
    const c = fakeFetch({ '/user': () => ({ status: 200, body: {} }) });
    await githubGet('/user', { fetchFn: c.fetchFn, token: null });
    expect(headersOf(c.calls)['authorization']).toBe('Bearer ghp_read');
  });

  it('an accept override reaches the header', async () => {
    const { fetchFn, calls } = fakeFetch({ '/repos/acme/widgets/readme': () => ({ status: 200, raw: '# hi' }) });
    const r = await githubGet('/repos/acme/widgets/readme', { fetchFn, accept: 'application/vnd.github.raw+json' });
    expect(headersOf(calls)['accept']).toBe('application/vnd.github.raw+json');
    // a body that is not JSON comes back as null, still with its status
    expect(r).toMatchObject({ status: 200, json: null });
  });

  it('a non-2xx is a value, not a throw', async () => {
    const { fetchFn } = fakeFetch({ '/repos/acme/nope': () => ({ status: 404, body: { message: 'Not Found' } }) });
    const r = await githubGet('/repos/acme/nope', { fetchFn });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ message: 'Not Found' });
  });
});

describe('the App calls: JWT in, installation out, token minted per read', () => {
  const env = { GITHUB_APP_ID: '77', GITHUB_APP_PRIVATE_KEY_B64: pemB64 };
  const expectAppJwt = (call: Call): void => {
    const bearer = call.headers['authorization'] ?? '';
    expect(bearer.startsWith('Bearer ')).toBe(true);
    const { valid, payload } = decodeJwt(bearer.slice('Bearer '.length));
    expect(valid).toBe(true);
    expect(payload['iss']).toBe('77');
  };

  it('findInstallation: 200 names the installation', async () => {
    const { fetchFn, calls } = fakeFetch({ '/repos/acme/widgets/installation': () => ({ status: 200, body: { id: 9001, account: { login: 'acme' }, repository_selection: 'selected' } }) });
    expect(await findInstallation('acme/widgets', { fetchFn, env })).toEqual({ id: 9001, account: 'acme' });
    expect(calls.map((c) => c.url)).toEqual(['https://api.github.com/repos/acme/widgets/installation']);
    expectAppJwt(calls[0]!);
  });

  it('findInstallation: 404 is null (not installed, or not visible: GitHub does not say which)', async () => {
    const { fetchFn } = fakeFetch({ '/repos/acme/widgets/installation': () => ({ status: 404, body: { message: 'Not Found' } }) });
    expect(await findInstallation('acme/widgets', { fetchFn, env })).toBeNull();
  });

  it('findInstallation: any other refusal throws with the status', async () => {
    const { fetchFn } = fakeFetch({ '/repos/acme/widgets/installation': () => ({ status: 500, body: { message: 'boom' } }) });
    const err = await findInstallation('acme/widgets', { fetchFn, env }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).status).toBe(500);
  });

  it('findInstallation reads process.env when no env is given', async () => {
    vi.stubEnv('GITHUB_APP_ID', '77');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY_B64', pemB64);
    const { fetchFn, calls } = fakeFetch({ '/repos/acme/widgets/installation': () => ({ status: 200, body: { id: 1, account: { login: 'acme' } } }) });
    expect(await findInstallation('acme/widgets', { fetchFn })).toEqual({ id: 1, account: 'acme' });
    expectAppJwt(calls[0]!);
  });

  it('installationToken: a POST with the App JWT, the token and its expiry back', async () => {
    const { fetchFn, calls } = fakeFetch({ '/app/installations/9001/access_tokens': () => ({ status: 201, body: { token: 'ghs_inst', expires_at: '2026-09-17T13:00:00Z', permissions: { metadata: 'read' } } }) });
    expect(await installationToken(9001, { fetchFn, env })).toEqual({ token: 'ghs_inst', expiresAt: '2026-09-17T13:00:00Z' });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expectAppJwt(calls[0]!);
  });

  it('installationToken: a refusal throws with the status', async () => {
    const { fetchFn } = fakeFetch({ '/app/installations/9001/access_tokens': () => ({ status: 401, body: { message: 'Bad credentials' } }) });
    const err = await installationToken(9001, { fetchFn, env }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).status).toBe(401);
  });

  it('installationToken: a 2xx without a token is still a refusal', async () => {
    const { fetchFn } = fakeFetch({ '/app/installations/9001/access_tokens': () => ({ status: 200, body: {} }) });
    await expect(installationToken(9001, { fetchFn, env })).rejects.toBeInstanceOf(GitHubApiError);
  });
});

describe('installUrl: GitHub’s own install page', () => {
  it('defaults the slug to neuramesh and encodes the state', () => {
    expect(installUrl('a b&c=d', {})).toBe('https://github.com/apps/neuramesh/installations/new?state=a%20b%26c%3Dd');
    expect(installUrl('s1', { GITHUB_APP_SLUG: 'neuramesh-dev' })).toBe('https://github.com/apps/neuramesh-dev/installations/new?state=s1');
  });
});

describe('verifyWebhookSignature: sha256 over the raw body, timing-safe', () => {
  const body = '{"action":"published","release":{"tag_name":"v1.2.0"}}';
  const sig = (secret: string): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('true for GitHub’s signature, false for a forged or truncated one', () => {
    const env = { GITHUB_APP_WEBHOOK_SECRET: 'whs_1' };
    expect(verifyWebhookSignature(body, sig('whs_1'), env)).toBe(true);
    expect(verifyWebhookSignature(body, sig('whs_2'), env)).toBe(false);
    expect(verifyWebhookSignature(body, sig('whs_1').slice(0, -2), env)).toBe(false);
    expect(verifyWebhookSignature(`${body} `, sig('whs_1'), env)).toBe(false);
    expect(verifyWebhookSignature(body, null, env)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, env)).toBe(false);
  });

  it('an unset secret accepts nothing', () => {
    expect(verifyWebhookSignature(body, sig('whs_1'), {})).toBe(false);
    expect(verifyWebhookSignature(body, sig(''), {})).toBe(false);
  });
});

describe('readRepoSignals: the server twin of the daemon read', () => {
  const since = '2026-09-10T18:00:00.000Z';
  const repo = { private: false, homepage: 'https://widgets.dev', default_branch: 'main', description: 'Widgets for everyone', stargazers_count: 12 };
  const releases = [
    { tag_name: 'v1.2.0', name: 'v1.2.0: the shared inbox', body: 'A shared inbox.', published_at: '2026-09-12T09:00:00Z', html_url: 'https://github.com/acme/widgets/releases/tag/v1.2.0', draft: false, prerelease: false, assets: [] },
    { tag_name: 'v1.3.0-draft', name: 'wip', body: null, published_at: null, html_url: 'https://github.com/acme/widgets/releases/tag/untagged', draft: true, prerelease: false },
    { tag_name: 'v1.1.0-rc.1', name: null, body: null, published_at: '2026-09-01T09:00:00Z', html_url: 'https://github.com/acme/widgets/releases/tag/v1.1.0-rc.1', draft: false, prerelease: true },
  ];
  const pulls = [
    { number: 41, title: 'Add the shared inbox', body: 'Closes #12', labels: [{ name: 'feature', color: 'aaa' }], merged_at: '2026-09-12T08:30:00Z', updated_at: '2026-09-12T08:30:00Z', html_url: 'https://github.com/acme/widgets/pull/41', user: { login: 'ada', id: 1 }, state: 'closed' },
    { number: 40, title: 'chore: bump deps', body: null, merged_at: '2026-09-10T05:00:00Z', updated_at: '2026-09-10T05:00:00Z', html_url: 'https://github.com/acme/widgets/pull/40', user: null, state: 'closed' },
    { number: 39, title: 'Closed, never merged', body: null, labels: [], merged_at: null, updated_at: '2026-09-11T00:00:00Z', html_url: 'https://github.com/acme/widgets/pull/39', user: { login: 'bob' }, state: 'closed' },
    { number: 38, title: 'Before the window', body: null, labels: [], merged_at: '2026-09-09T23:59:59Z', updated_at: '2026-09-09T23:59:59Z', html_url: 'https://github.com/acme/widgets/pull/38', user: { login: 'ada' }, state: 'closed' },
  ];
  const paths = {
    repo: '/repos/acme/widgets',
    releases: '/repos/acme/widgets/releases?per_page=15',
    pulls: '/repos/acme/widgets/pulls?state=closed&sort=updated&direction=desc&per_page=100',
    tags: '/repos/acme/widgets/tags?per_page=5',
  };
  const api = (p: string): string => `https://api.github.com${p}`;

  it('reads the repository, the releases and the merged pull requests since the cursor’s day', async () => {
    const { fetchFn, calls } = fakeFetch({
      [paths.repo]: () => ({ status: 200, body: repo }),
      [paths.releases]: () => ({ status: 200, body: releases }),
      [paths.pulls]: () => ({ status: 200, body: pulls }),
    });
    const out = await readRepoSignals('acme/widgets', since, { fetchFn });
    // the exact reads, in order, and no tags call while the repository publishes releases
    expect(calls.map((c) => c.url)).toEqual([api(paths.repo), api(paths.releases), api(paths.pulls)]);
    expect(out.repo).toEqual({ private: false, homepage: 'https://widgets.dev', defaultBranch: 'main', description: 'Widgets for everyone' });
    // the release mapping: the unpublished draft is gone, the prerelease is carried with its flag
    expect(out.releases).toEqual([
      { tag: 'v1.2.0', name: 'v1.2.0: the shared inbox', body: 'A shared inbox.', publishedAt: '2026-09-12T09:00:00Z', url: 'https://github.com/acme/widgets/releases/tag/v1.2.0', draft: false, prerelease: false },
      { tag: 'v1.1.0-rc.1', name: null, body: null, publishedAt: '2026-09-01T09:00:00Z', url: 'https://github.com/acme/widgets/releases/tag/v1.1.0-rc.1', draft: false, prerelease: true },
    ]);
    // the pull-request mapping: only what merged on or after the cursor's DAY, in the ScanPr shape
    // and nothing else. #40 merged earlier the same day as the cursor and stays (day granularity,
    // the daemon's `merged:>=` twin); #39 never merged; #38 merged the day before.
    expect(out.prs).toEqual([
      { number: 41, title: 'Add the shared inbox', body: 'Closes #12', labels: ['feature'], mergedAt: '2026-09-12T08:30:00Z', url: 'https://github.com/acme/widgets/pull/41', author: 'ada' },
      { number: 40, title: 'chore: bump deps', body: null, labels: [], mergedAt: '2026-09-10T05:00:00Z', url: 'https://github.com/acme/widgets/pull/40', author: null },
    ]);
    expect(out.tags).toEqual([]);
  });

  it('a repository without releases resolves its tags and each tag’s commit date', async () => {
    const { fetchFn, calls } = fakeFetch({
      [paths.repo]: () => ({ status: 200, body: { ...repo, private: true, homepage: '', description: null } }),
      [paths.releases]: () => ({ status: 200, body: [] }),
      [paths.pulls]: () => ({ status: 200, body: [] }),
      [paths.tags]: () => ({ status: 200, body: [{ name: 'v0.2.0', commit: { sha: 'abc123' } }, { name: 'v0.1.0', commit: { sha: 'def456' } }] }),
      '/repos/acme/widgets/commits/abc123': () => ({ status: 200, body: { sha: 'abc123', commit: { committer: { date: '2026-09-11T09:00:00Z' } } } }),
      '/repos/acme/widgets/commits/def456': () => ({ status: 500, body: { message: 'boom' } }),
    });
    const out = await readRepoSignals('acme/widgets', since, { fetchFn });
    expect(calls.map((c) => c.url)).toEqual([
      api(paths.repo), api(paths.releases), api(paths.pulls), api(paths.tags),
      api('/repos/acme/widgets/commits/abc123'), api('/repos/acme/widgets/commits/def456'),
    ]);
    expect(out.repo).toEqual({ private: true, homepage: null, defaultBranch: 'main', description: null });
    expect(out.tags).toEqual([
      { name: 'v0.2.0', date: '2026-09-11T09:00:00Z', url: 'https://github.com/acme/widgets/releases/tag/v0.2.0' },
      { name: 'v0.1.0', date: null, url: 'https://github.com/acme/widgets/releases/tag/v0.1.0' },
    ]);
  });

  it.each([404, 403])('the repository answering %i throws with the status and reads nothing more', async (status) => {
    const { fetchFn, calls } = fakeFetch({ [paths.repo]: () => ({ status, body: { message: 'Not Found' } }) });
    const err = await readRepoSignals('acme/widgets', since, { fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).status).toBe(status);
    expect(calls.map((c) => c.url)).toEqual([api(paths.repo)]);
  });

  it('a token rides every call, and the pulls read is tolerated when it fails', async () => {
    const { fetchFn, calls } = fakeFetch({
      [paths.repo]: () => ({ status: 200, body: repo }),
      [paths.releases]: () => ({ status: 200, body: releases }),
      [paths.pulls]: () => ({ status: 502, body: { message: 'bad gateway' } }),
    });
    const out = await readRepoSignals('acme/widgets', since, { fetchFn, token: 'ghs_inst' });
    expect(calls.map((c) => c.headers['authorization'])).toEqual(['Bearer ghs_inst', 'Bearer ghs_inst', 'Bearer ghs_inst']);
    expect(out.prs).toEqual([]);
    expect(out.releases).toHaveLength(2);
  });

  it('the releases read is not tolerated: it throws with the status', async () => {
    const { fetchFn } = fakeFetch({
      [paths.repo]: () => ({ status: 200, body: repo }),
      [paths.releases]: () => ({ status: 429, body: { message: 'rate limited' } }),
    });
    const err = await readRepoSignals('acme/widgets', since, { fetchFn }).catch((e: unknown) => e);
    expect((err as GitHubApiError).status).toBe(429);
  });
});
