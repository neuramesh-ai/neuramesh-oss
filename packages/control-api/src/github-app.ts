// The NeuraMesh GitHub App client for the public announce door (docs/design/release-drafts-2026-09
// §4.8 and §5.2). The platform holds the App's private key and nothing else: an installation token
// is minted per read, lives an hour on GitHub's side, and is never written to a row. A public
// repository reads with GITHUB_READ_TOKEN when set (Vercel's egress IPs share the anonymous limit
// with every other tenant), else anonymously. Gated on the App envs, the providerConfigured idiom:
// absent, the App entries throw and the connect routes answer 501, exactly like the social flows.
//
// Raw fetch, no SDK and no jsonwebtoken: the App JWT is three base64url parts and one RSA-SHA256
// signature from node:crypto (clerk.ts verifies the same shape from the other side), and
// build:vercel externalizes dependencies by name (the mail.ts precedent).
import { createHmac, createPrivateKey, createSign, timingSafeEqual } from 'node:crypto';
import type { ScanPr, ScanRelease, ScanTag } from '@neuramesh/shared';

type Env = Record<string, string | undefined>;
const API = 'https://api.github.com';
const UA = 'neuramesh-announce';

export function githubAppConfigured(env: Env = process.env): boolean {
  return !!env['GITHUB_APP_ID'] && !!(env['GITHUB_APP_PRIVATE_KEY_B64'] || env['GITHUB_APP_PRIVATE_KEY']);
}

const appSlug = (env: Env): string => env['GITHUB_APP_SLUG'] || 'neuramesh';

/** The App's PEM: base64 on Vercel (a multi-line secret survives no env editor), or the PEM itself
 *  with `\n` escapes tolerated. GitHub hands out PKCS#1; node:crypto reads PKCS#1 and PKCS#8 alike. */
function privateKeyPem(env: Env): string {
  const b64 = env['GITHUB_APP_PRIVATE_KEY_B64'];
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  return (env['GITHUB_APP_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n');
}

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

/** The App's own identity: RS256, iat a minute in the past (GitHub rejects a clock that runs
 *  ahead), good for nine minutes (GitHub caps a JWT at ten). */
export function appJwt(env: Env = process.env, now: number = Date.now()): string {
  const id = env['GITHUB_APP_ID'];
  const pem = privateKeyPem(env);
  if (!id || !pem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64 (or GITHUB_APP_PRIVATE_KEY) are not set');
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 540, iss: id }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(createPrivateKey(pem)).toString('base64url');
  return `${head}.${body}.${sig}`;
}

// github.com/<first segment> pages that are not an owner: a pasted org listing or an App page must
// answer "paste owner/repo", never "private or missing"
const RESERVED = new Set(['orgs', 'organizations', 'apps', 'settings', 'marketplace', 'topics', 'explore', 'search', 'login', 'join', 'features', 'sponsors', 'notifications', 'issues', 'pulls', 'new', 'about', 'pricing', 'enterprise', 'users', 'collections', 'trending', 'codespaces']);

/** `owner/repo`, a github.com URL (with any page path behind the repository), or an ssh remote →
 *  the slug. An owner is `[\w-]` (GitHub owners carry no dots, which is what keeps another host's
 *  `gitlab.com/owner` from reading as a slug), a repository `[\w.-]` minus `.git`. Null otherwise. */
export function parseRepoInput(text: string): { slug: string } | null {
  let s = (text ?? '').trim()
    .replace(/^git@github\.com:/i, 'github.com/')
    .replace(/^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?/i, '')
    .replace(/^www\./i, '');
  const hosted = /^github\.com\//i.test(s);
  if (hosted) s = s.slice('github.com/'.length);
  const parts = s.split(/[/?#]/);
  const [owner = '', repoRaw = ''] = parts;
  const repo = repoRaw.replace(/\.git$/i, '');
  // a bare paste is owner/repo and nothing more (a trailing slash tolerated)
  if (!hosted && parts.filter(Boolean).length !== 2) return null;
  if (!/^[\w-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || /^\.+$/.test(repo)) return null;
  if (RESERVED.has(owner.toLowerCase())) return null;
  return { slug: `${owner}/${repo}` };
}

/** A GitHub answer the caller must act on: the status rides the error so the announce door can
 *  tell private-or-missing (403, 404) from everything else. */
export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubReply { status: number; json: unknown; headers: Headers }
export interface GitHubOpts { token?: string | null; fetchFn?: typeof fetch; accept?: string; env?: Env }
/** the App calls mint their own JWT: `now` pins its clock in tests */
export interface AppOpts extends Omit<GitHubOpts, 'token'> { now?: number }

async function request(method: 'GET' | 'POST', path: string, opts: GitHubOpts): Promise<GitHubReply> {
  const env = opts.env ?? process.env;
  const token = opts.token ?? env['GITHUB_READ_TOKEN'] ?? '';
  const headers: Record<string, string> = {
    accept: opts.accept ?? 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': UA,
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(10_000) };
  if (method === 'POST') { headers['content-type'] = 'application/json'; init.body = '{}'; }
  const res = await (opts.fetchFn ?? fetch)(`${API}${path}`, init);
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

const ok = (r: GitHubReply): boolean => r.status >= 200 && r.status < 300;

/** GET on api.github.com. Never throws on a non-2xx: the status and the parsed body (or null) come
 *  back, and the caller decides. The bearer is the given token, else GITHUB_READ_TOKEN, else none. */
export function githubGet(path: string, opts: GitHubOpts = {}): Promise<GitHubReply> {
  return request('GET', path, opts);
}

/** Is the App installed for this repository? Null on 404 (not installed, or a repository the App
 *  cannot see: GitHub does not tell which). Any other refusal throws with its status. */
export async function findInstallation(slug: string, opts: AppOpts = {}): Promise<{ id: number; account: string } | null> {
  const r = await request('GET', `/repos/${slug}/installation`, { ...opts, token: appJwt(opts.env, opts.now) });
  if (r.status === 404) return null;
  if (!ok(r)) throw new GitHubApiError(`GitHub answered ${r.status} for the ${slug} installation`, r.status);
  const b = r.json as { id: number; account?: { login?: string; slug?: string } | null };
  return { id: b.id, account: b.account?.login ?? b.account?.slug ?? '' };
}

/** One installation token, minted now, one hour on GitHub's side. Held in memory for the read and
 *  never written down (plan §4.9). */
export async function installationToken(installationId: number, opts: AppOpts = {}): Promise<{ token: string; expiresAt: string }> {
  const r = await request('POST', `/app/installations/${installationId}/access_tokens`, { ...opts, token: appJwt(opts.env, opts.now) });
  const b = r.json as { token?: string; expires_at?: string } | null;
  if (!ok(r) || !b?.token) throw new GitHubApiError(`GitHub refused an installation token (${r.status})`, r.status);
  return { token: b.token, expiresAt: b.expires_at ?? '' };
}

/** GitHub's own install page: the person picks the repositories, GitHub calls back with the state */
export function installUrl(state: string, env: Env = process.env): string {
  return `https://github.com/apps/${appSlug(env)}/installations/new?state=${encodeURIComponent(state)}`;
}

/** `X-Hub-Signature-256: sha256=<hmac>` over the raw body. False without a secret: an unset
 *  webhook lane accepts nothing, not everything. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null | undefined, env: Env = process.env): boolean {
  const secret = env['GITHUB_APP_WEBHOOK_SECRET'];
  if (!secret || !signatureHeader) return false;
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`);
  const got = Buffer.from(signatureHeader);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ── the read ───────────────────────────────────────────────────────────────────────────────────

export interface RepoFacts { private: boolean; homepage: string | null; defaultBranch: string; description: string | null }
export interface RepoSignals { releases: ScanRelease[]; prs: ScanPr[]; tags: ScanTag[]; repo: RepoFacts }
type ReleaseRow = { tag_name: string; name: string | null; body: string | null; published_at: string | null; html_url: string; draft: boolean; prerelease: boolean };
type PullRow = { number: number; title: string; body: string | null; labels?: Array<{ name: string }>; merged_at: string | null; html_url: string; user?: { login?: string } | null };
type TagRow = { name: string; commit: { sha: string } };
type RepoRow = { private?: boolean; homepage?: string | null; default_branch?: string; description?: string | null };

const rows = <T>(r: GitHubReply): T[] => (ok(r) && Array.isArray(r.json) ? (r.json as T[]) : []);
const day = (iso: string): string => iso.slice(0, 10);

/**
 * The server twin of the daemon's readRepoSignals (host/releasewatch.ts): the repository, its
 * releases, the pull requests merged since the cursor's day, and tags when it publishes no
 * releases. Merged pull requests come from the pulls list (closed, newest update first), not the
 * search index: primary data with no index lag, the core rate limit instead of the search one, and a
 * certain fit under the App's `pull_requests: read`. A merge is an update, so every pull request
 * merged after `since` sorts ahead of any last touched before it, and one page of 100 is the same
 * window the daemon's `--limit 100` reads. The repository itself must answer: 403 and 404 throw with
 * the status, which is how the door says private-or-missing.
 */
export async function readRepoSignals(slug: string, since: string, opts: Omit<GitHubOpts, 'accept'> = {}): Promise<RepoSignals> {
  const get = (path: string): Promise<GitHubReply> => githubGet(path, opts);
  const repoRes = await get(`/repos/${slug}`);
  if (!ok(repoRes)) throw new GitHubApiError(`GitHub answered ${repoRes.status} for ${slug}`, repoRes.status);
  const row = (repoRes.json ?? {}) as RepoRow;
  const repo: RepoFacts = { private: row.private === true, homepage: row.homepage || null, defaultBranch: row.default_branch || 'main', description: row.description || null };

  const rel = await get(`/repos/${slug}/releases?per_page=15`);
  if (!ok(rel)) throw new GitHubApiError(`GitHub answered ${rel.status} for the releases of ${slug}`, rel.status);
  const releases: ScanRelease[] = rows<ReleaseRow>(rel)
    .filter((r) => r.published_at)
    .map((r) => ({ tag: r.tag_name, name: r.name, body: r.body, publishedAt: r.published_at!, url: r.html_url, draft: r.draft, prerelease: r.prerelease }));

  const from = new Date(`${day(since)}T00:00:00Z`).getTime() || 0;
  const pulls = await get(`/repos/${slug}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
  const prs: ScanPr[] = rows<PullRow>(pulls)
    .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= from)
    .map((p) => ({ number: p.number, title: p.title, body: p.body, labels: (p.labels ?? []).map((l) => l.name), mergedAt: p.merged_at!, url: p.html_url, author: p.user?.login ?? null }));

  const tags: ScanTag[] = [];
  if (!releases.length) {
    for (const t of rows<TagRow>(await get(`/repos/${slug}/tags?per_page=5`))) {
      const c = await get(`/repos/${slug}/commits/${t.commit.sha}`);
      const date = ok(c) ? ((c.json as { commit?: { committer?: { date?: string } } }).commit?.committer?.date ?? null) : null;
      tags.push({ name: t.name, date, url: `https://github.com/${slug}/releases/tag/${t.name}` });
    }
  }
  return { releases, prs, tags, repo };
}
