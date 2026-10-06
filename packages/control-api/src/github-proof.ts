// The GitHub owner proof, its GitHub side (docs/design/github-owner-proof-2026-10/plan.md). GitHub
// does not sign the installation_id that the Setup URL carries, and its own Setup URL page says to
// check the person with a user access token instead. So a grant starts at GitHub's authorize page,
// GitHub sends the code to hq's page, and hq sends it back here with the person's own session
// (github-prove.ts): the user token then lists the repositories that the person's own GitHub account
// reads through the App.
//
// Here: the grant's state, the authorize link, the code exchange, the reads with the user token, the
// App's own lookup of a repository's installation, the token delete, and the map from GitHub's
// answers to the plan's codes. The user token lives in the caller's locals only: never in a row, a
// state, a page, a redirect, an error message or a log line.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { keyBytes, seal, unseal } from './connector-crypto';
import { appJwt, GitHubApiError, githubAppConfigured, githubGet, type GitHubReply } from './github-app';
import { HQ_URL } from './mail';

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;
const UA = 'neuramesh-announce';

/** the proof is on only with the App, both client values and the key that seals the state */
export function ownerProofConfigured(env: Env = process.env): boolean {
  return githubAppConfigured(env) && !!env['GITHUB_APP_CLIENT_ID'] && !!env['GITHUB_APP_CLIENT_SECRET'] && !!env['NM_CONNECTOR_KEY'];
}

// ── the state ──────────────────────────────────────────────────────────────────────────────────
/** the sealed state of an in-app grant; `github: 1` keeps a social state from ever parsing as one */
export interface GrantState { github: 1; workspace: string; channel: string | null; actor: string; slug: string | null }
/** a proof grant's state: the in-app state, its birth (seconds) and a random nonce */
export interface ProofState extends GrantState { iat: number; nonce: string }
/** who opens the grant: `w` the browser, `p` the phone. It rides OUTSIDE the seal, so hq's page
 *  routes a phone grant back to the app without the key */
export type GrantClient = 'w' | 'p';
export const STATE_TTL_S = 3600;

export function sealProofState(client: GrantClient, s: GrantState, now: number = Date.now()): string {
  const state: ProofState = { ...s, iat: Math.floor(now / 1000), nonce: randomBytes(16).toString('base64url') };
  return `${client}.${seal(state)}`;
}

/** null unless the state is ours, whole: the seal holds, and it names the workspace, the person, its birth and its nonce */
export function unsealProofState(raw: string): { client: GrantClient; state: ProofState } | null {
  const m = /^([wp])\.([\w-]+)$/.exec(raw);
  if (!m) return null;
  try {
    const s = unseal<Partial<ProofState>>(m[2]!);
    const whole = s?.github === 1 && typeof s.workspace === 'string' && !!s.workspace && typeof s.actor === 'string' && !!s.actor
      && typeof s.iat === 'number' && Number.isFinite(s.iat) && typeof s.nonce === 'string' && !!s.nonce;
    return whole ? { client: m[1] as GrantClient, state: s as ProofState } : null;
  } catch { return null; }
}

export const isProofState = (raw: string): boolean => /^[wp]\./.test(raw);

// ── the links ──────────────────────────────────────────────────────────────────────────────────
/** hq's page: GitHub sends the code and the state there, and the page sends them on with the session */
export const proofRedirectUri = (): string => `${HQ_URL}/github/callback`;

/** hq's page for the public start: it asks the signed-in resolve for the grant link, so the state names the
 *  session's person. The start's own query proves nobody, so it names no person here */
export const grantStartUrl = (channel: string | null): string =>
  `${HQ_URL}/github/start${channel ? `?${new URLSearchParams({ channel }).toString()}` : ''}`;

/** the grant's PKCE verifier, from the state and the connector key: only this server computes it. GitHub
 *  binds its code to the challenge on the link, so a code redeems only with the state of its own link */
export const pkceVerifier = (state: string): string => createHmac('sha256', keyBytes()).update(`github-pkce:${state}`).digest('base64url');

/** GitHub's authorize page for the App. A person who authorized the App before sees no page */
export function authorizeUrl(state: string, env: Env = process.env): string {
  const challenge = createHash('sha256').update(pkceVerifier(state)).digest('base64url');
  const q = new URLSearchParams({ client_id: env['GITHUB_APP_CLIENT_ID'] ?? '', redirect_uri: proofRedirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `https://github.com/login/oauth/authorize?${q.toString()}`;
}

// ── the refusals ───────────────────────────────────────────────────────────────────────────────
export type ProofCode = 'OTHER_ACCOUNT' | 'NOT_MEMBER' | 'EXPIRED' | 'BAD_STATE' | 'CODE_REFUSED' | 'SSO' | 'NO_ACCESS' | 'EMAIL' | 'DENIED' | 'REQUEST' | 'GITHUB_DOWN' | 'MISCONFIGURED' | 'NOT_CONFIGURED';
export const PROOF_WORDS: Record<ProofCode, string> = {
  OTHER_ACCOUNT: 'This grant started for another neuramesh account. Sign in as that account, or start the grant again from your own room.',
  NOT_MEMBER: 'You are not a member of the workspace that holds this room.',
  EXPIRED: 'This grant is more than an hour old. Start again from neuramesh.',
  BAD_STATE: 'This grant link is not valid. Start again from neuramesh.',
  // a code that GitHub refused: used, older than ten minutes, or from another grant's link
  CODE_REFUSED: 'GitHub did not accept this grant. Start again from neuramesh.',
  SSO: 'Your organization on GitHub uses single sign-on. Sign in to it on GitHub, then grant access again.',
  NO_ACCESS: 'Your GitHub account has no access to this repository. Get access from an owner, or use another GitHub account. Then grant access again.',
  EMAIL: 'GitHub needs a verified email on your account. Verify your primary email on GitHub, then grant access again.',
  DENIED: 'You did not let the neuramesh app confirm your GitHub account. Nothing changed. Grant access again from neuramesh.',
  REQUEST: 'GitHub sent your request to the owners of the account. When an owner approves it, grant access again from neuramesh.',
  GITHUB_DOWN: 'GitHub did not answer. Nothing changed. Try again in a few minutes.',
  MISCONFIGURED: 'neuramesh cannot finish the grant now.',
  NOT_CONFIGURED: 'neuramesh cannot finish the grant now.',
};

/** what a refusal names beside its words: the organization's single sign-on page, or the GitHub login and the repository */
export interface RefusalNames { sso?: string; login?: string; slug?: string }

export class ProofRefusal extends Error {
  constructor(readonly code: ProofCode, words: string = PROOF_WORDS[code], readonly names: RefusalNames = {}) {
    super(words);
    this.name = 'ProofRefusal';
  }
}

/** the App's own setup is wrong: one loud line for the operator, and the person sees the plain words.
 *  `why` is a fixed phrase or GitHub's error name, cut to safe characters */
export function misconfigured(why: string): ProofRefusal {
  console.error(`github owner proof: the App cannot finish a grant (${why.replace(/[^\w ./-]/g, '').slice(0, 80)}). Check GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and the App's Callback URL.`);
  return new ProofRefusal('MISCONFIGURED');
}

/** the person's own read of the room's repository met SAML single sign-on: a user token reaches the
 *  organization only after the person signs in to it. An installation that names no organization
 *  login gets the plain words and no link, because `/orgs//sso` is no page */
export const ssoRefusal = (org: string): ProofRefusal => org
  ? new ProofRefusal('SSO', `The organization ${org} uses single sign-on. Sign in to it on GitHub, then grant access again.`, { sso: `https://github.com/orgs/${encodeURIComponent(org)}/sso` })
  : new ProofRefusal('SSO');

/** the App reads the room's repository, and the person's own GitHub account has no access to it */
export function noAccessRefusal(login: string, slug: string): ProofRefusal {
  const account = login ? `Your GitHub account ${login}` : 'Your GitHub account';
  const words = `${account} has no access to ${slug}. Get access from an owner of ${slug.split('/')[0]}, or use another GitHub account. Then grant access again.`;
  return new ProofRefusal('NO_ACCESS', words, { login, slug });
}

/** GitHub's own error parameter, from the authorize page or the Setup URL hop */
export function authorizeRefusal(error: string): ProofRefusal {
  if (error === 'access_denied') return new ProofRefusal('DENIED');
  if (error === 'request') return new ProofRefusal('REQUEST');
  return misconfigured(error);
}

/** busy or down: a 5xx, a rate limit (429, or 403 with no calls left or a retry-after) */
export const busy = (status: number, headers?: Headers): boolean =>
  status >= 500 || status === 429 || (status === 403 && (headers?.get('x-ratelimit-remaining') === '0' || !!headers?.has('retry-after')));

/** a call that GitHub never answered: a timeout, a dead network (undici's own words), or a busy answer that a helper threw */
export const unreachable = (e: unknown): boolean =>
  (e instanceof GitHubApiError && busy(e.status, e.headers))
  || (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError' || (e instanceof TypeError && e.message === 'fetch failed')));

// ── the calls ──────────────────────────────────────────────────────────────────────────────────
/** the code for a user token: POST github.com/login/oauth/access_token, with the PKCE verifier of the
 *  grant's state. An `error` field at any status is a refusal, and a body that does not parse is no answer */
export async function exchangeCode(code: string, state: string, fetchFn: Fetch, env: Env = process.env): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ client_id: env['GITHUB_APP_CLIENT_ID'], client_secret: env['GITHUB_APP_CLIENT_SECRET'], code, redirect_uri: proofRedirectUri(), code_verifier: pkceVerifier(state) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new ProofRefusal('GITHUB_DOWN'); }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
  if (body && typeof body.error === 'string') {
    if (body.error === 'unverified_user_email') throw new ProofRefusal('EMAIL');
    if (body.error === 'bad_verification_code') throw new ProofRefusal('CODE_REFUSED');
    throw misconfigured(body.error);
  }
  if (busy(res.status, res.headers) || !body) throw new ProofRefusal('GITHUB_DOWN');
  if (!res.ok) throw misconfigured(`the code exchange answered ${res.status}`);
  if (typeof body.access_token !== 'string' || !body.access_token) throw new ProofRefusal('GITHUB_DOWN');
  return body.access_token;
}

/** one read with the user token; busy and unreachable are GITHUB_DOWN, every other status is the caller's */
async function userRead(path: string, token: string, fetchFn: Fetch): Promise<GitHubReply> {
  const r = await githubGet(path, { token, fetchFn }).catch(() => null);
  if (!r || busy(r.status, r.headers)) throw new ProofRefusal('GITHUB_DOWN');
  return r;
}

export async function githubUser(token: string, fetchFn: Fetch): Promise<{ id: number; login: string }> {
  const r = await userRead('/user', token, fetchFn);
  const b = r.json as { id?: unknown; login?: unknown } | null;
  if (r.status !== 200 || typeof b?.id !== 'number') throw misconfigured(`GET /user answered ${r.status}`);
  return { id: b.id, login: typeof b.login === 'string' ? b.login : '' };
}

export interface ProvenInstallation { installationId: number; account: string; selection: 'all' | 'selected'; repoIds: number[]; repos: string[] }
export interface Walk { installations: ProvenInstallation[]; truncated: boolean }
const PER_PAGE = 100;
const PAGES = 10;
/** repository pages for all installations together, so one person in many accounts cannot hold the request past its time */
const REPO_PAGE_BUDGET = 30;
type InstallationRow = { id: number; account?: { login?: string } | null; repository_selection?: string; suspended_at?: string | null };

/** GitHub's lists for the user token: the App's installations that the person reaches (a suspended one
 *  reads nothing), and for each the repositories that the person's own account reads. A 403 or 404 on one
 *  installation's list drops that installation only. Past a cap the walk is `truncated`. */
export async function walkInstallations(token: string, fetchFn: Fetch): Promise<Walk> {
  const listed = await listInstallations(token, fetchFn);
  let truncated = listed.truncated;
  const budget = { pages: REPO_PAGE_BUDGET };
  const installations: ProvenInstallation[] = [];
  for (const inst of listed.rows) {
    if (inst.suspended_at) continue;
    const read = await listRepositories(inst, token, fetchFn, budget);
    truncated ||= read.truncated;
    if (read.proven.repos.length) installations.push(read.proven);
  }
  return { installations, truncated };
}

async function listInstallations(token: string, fetchFn: Fetch): Promise<{ rows: InstallationRow[]; truncated: boolean }> {
  const rows: InstallationRow[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const r = await userRead(`/user/installations?per_page=${PER_PAGE}&page=${page}`, token, fetchFn);
    if (r.status !== 200) throw misconfigured(`GET /user/installations answered ${r.status}`);
    const b = r.json as { total_count?: number; installations?: InstallationRow[] } | null;
    const got = b?.installations ?? [];
    rows.push(...got);
    if (got.length < PER_PAGE || rows.length >= (b?.total_count ?? Infinity)) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function listRepositories(inst: InstallationRow, token: string, fetchFn: Fetch, budget: { pages: number }): Promise<{ proven: ProvenInstallation; truncated: boolean }> {
  const proven: ProvenInstallation = { installationId: inst.id, account: inst.account?.login ?? '', selection: inst.repository_selection === 'all' ? 'all' : 'selected', repoIds: [], repos: [] };
  for (let page = 1; page <= PAGES; page++) {
    if (budget.pages-- <= 0) return { proven, truncated: true };
    const r = await userRead(`/user/installations/${inst.id}/repositories?per_page=${PER_PAGE}&page=${page}`, token, fetchFn);
    if (r.status !== 200) return { proven: { ...proven, repoIds: [], repos: [] }, truncated: false };
    const b = r.json as { total_count?: number; repositories?: Array<{ id: number; full_name: string }> } | null;
    const got = b?.repositories ?? [];
    for (const repo of got) { proven.repoIds.push(repo.id); proven.repos.push(repo.full_name.toLowerCase()); }
    if (got.length < PER_PAGE || proven.repos.length >= (b?.total_count ?? Infinity)) return { proven, truncated: false };
  }
  return { proven, truncated: true };
}

/** the App's installation for a repository, by the App's own key (null when none). Its answer decides
 *  between the install page and NO_ACCESS, so GitHub busy or down is GITHUB_DOWN, never "none".
 *  `org`: the installation is on an organization */
export async function appInstallation(slug: string, fetchFn: Fetch, env: Env = process.env): Promise<{ id: number; account: string; org: boolean } | null> {
  let r: GitHubReply | null = null;
  try { r = await githubGet(`/repos/${slug}/installation`, { token: appJwt(env), fetchFn }); }
  catch (e) { if (unreachable(e)) throw new ProofRefusal('GITHUB_DOWN'); return null; }
  if (busy(r.status, r.headers)) throw new ProofRefusal('GITHUB_DOWN');
  const b = r.json as { id?: unknown; account?: { login?: string; type?: string } | null; target_type?: string } | null;
  if (r.status !== 200 || typeof b?.id !== 'number') return null;
  return { id: b.id, account: b.account?.login ?? '', org: (b.target_type ?? b.account?.type) === 'Organization' };
}

/** the person's own read of the room's repository, when the App reads it and the person's lists do not show
 *  it (a large account's walk stops at a cap). A private repository that a user token reads is one that the
 *  App and the person both reach. A public one proves nothing (every account reads it), unless the person
 *  holds a role on it beyond read. 'sso': GitHub refused the token for SAML single sign-on, with its SSO
 *  header or SAML in its words. Null: no access. */
export async function directRepo(slug: string, token: string, fetchFn: Fetch): Promise<{ id: number; name: string } | 'sso' | null> {
  const r = await userRead(`/repos/${slug}`, token, fetchFn);
  const b = r.json as { id?: unknown; full_name?: string; private?: boolean; permissions?: Record<string, boolean>; message?: unknown } | null;
  if (r.status === 403 && (r.headers.has('x-github-sso') || /\bSAML\b/i.test(String(b?.message ?? '')))) return 'sso';
  if (r.status !== 200 || typeof b?.id !== 'number') return null;
  const role = b.permissions ?? {};
  if (b.private !== true && !role['triage'] && !role['push'] && !role['maintain'] && !role['admin']) return null;
  return { id: b.id, name: (b.full_name ?? slug).toLowerCase() };
}

/** the user token's end, best effort: `token` deletes this token, `grant` the whole authorization, so
 *  the next grant shows GitHub's page again. Basic auth with the App's client id and secret */
export async function dropAuthorization(token: string, what: 'token' | 'grant', fetchFn: Fetch, env: Env = process.env): Promise<void> {
  const id = env['GITHUB_APP_CLIENT_ID'] ?? '';
  const basic = Buffer.from(`${id}:${env['GITHUB_APP_CLIENT_SECRET'] ?? ''}`).toString('base64');
  try {
    const r = await fetchFn(`https://api.github.com/applications/${encodeURIComponent(id)}/${what}`, {
      method: 'DELETE',
      headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': UA, authorization: `Basic ${basic}` },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status !== 204) console.warn(`github owner proof: the ${what} delete answered ${r.status}`);
  } catch { console.warn(`github owner proof: the ${what} delete did not reach GitHub`); }
}
