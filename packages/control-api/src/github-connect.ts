// GitHub as a connector (docs/design/github-connector-2026-09): the platform's GitHub App as a
// per-project READ connector, and the reads the agents' tools ride.
//
// Custody, said plainly: the App's private key stays on the server, an installation token is minted
// per read (cached in memory for its hour, never written to a row), and a machine sees content,
// never a credential. The `connectors` row (provider 'github', handle = the repository slug) is the
// ACL: no row, no read. GitHub's refusal of the installation (removed on GitHub) marks the row
// `reauth_required`, the same verdict a dead social grant gets, so the attention bar lights.
//
// Two doors write the row: the install callback (the sealed state names the workspace, the room
// and the person, the social flows' idiom) and `POST /v1/github/resolve` (the app asks whether the
// App can read the room's repository now, and the row is written when it can). The resolve is what
// makes a grant that lands on another deployment's callback still count (the live trap of
// 2026-09-18, docs/44). The public announce door keeps its slug-state branch on the same routes.
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import type { Actor } from '@neuramesh/shared';
import { seal, unseal } from './connector-crypto';
import { actorInWorkspace } from './credits';
import { GitHubApiError, findInstallation, githubAppConfigured, githubGet, installUrl, installationToken, parseRepoInput, readRepoSignals } from './github-app';
import { installationFacts, readRepoCommits, readRepoFile, readRepoTree } from './github-reads';
import { APP_URL } from './mail';
import type { Store } from './store';
import type { AnnounceStore, PrimaryRepo } from './store/announce';

type Fetch = typeof fetch;
type ActorEnv = Env & { Variables: { actor: Actor } };
export const GITHUB_SCOPES = 'metadata:read contents:read pull_requests:read';
/** the sealed state of an in-app grant; `github: 1` keeps a social state from ever parsing as one */
interface GrantState { github: 1; workspace: string; channel: string | null; actor: string; slug: string | null }

/** `owner/repo` for a repository row: the clone URL first (the daemon's own order), else org/name; a
 *  locally attached checkout (`org_name = 'local'`, no URL) has no GitHub side to read */
export function slugOf(repo: PrimaryRepo): string | null {
  const fromUrl = repo.cloneUrl ? parseRepoInput(repo.cloneUrl)?.slug ?? null : null;
  if (fromUrl) return fromUrl;
  if (!repo.orgName || repo.orgName === 'local' || !repo.name) return null;
  return `${repo.orgName}/${repo.name}`;
}

/** the App's installation for a repository, VERIFIED: the table's row must still mint a token (a
 *  row GitHub answers 404 for is dead and forgotten: the live harness held a fake id for the same
 *  repository and it won the lookup), else GitHub's own answer, remembered with the installation's
 *  repository list. The token comes back with it, so a caller never mints twice. Shared with the
 *  announce door (it used to live there). */
export async function installationFor(ann: AnnounceStore, slug: string, fetchFn: Fetch, workspaceId: string | null = null): Promise<{ installationId: number; token: string } | null> {
  if (!githubAppConfigured()) return null;
  const known = await ann.installationForRepo(slug);
  if (known) {
    try { return { installationId: known.installationId, token: await tokenFor(known.installationId, fetchFn) }; }
    catch (e) {
      forgetToken(known.installationId);
      if (e instanceof GitHubApiError && e.status === 404) await ann.forgetInstallation(known.installationId).catch(() => {});
      else throw e;
    }
  }
  const found = await findInstallation(slug, { fetchFn }).catch(() => null);
  if (!found) return null;
  const token = await tokenFor(found.id, fetchFn).catch(() => null);
  if (!token) return null;
  await rememberInstallation(ann, found.id, fetchFn, workspaceId).catch(() => { /* the id is the answer; the memo is a convenience */ });
  return { installationId: found.id, token };
}

/** what GitHub says the installation covers, written down (account, selection, the first page of repositories) */
export async function rememberInstallation(ann: AnnounceStore, installationId: number, fetchFn: Fetch, workspaceId: string | null): Promise<void> {
  const tok = await tokenFor(installationId, fetchFn);
  const repos = await githubGet('/installation/repositories?per_page=100', { token: tok, fetchFn });
  const names = repos.status === 200 ? ((repos.json as { repositories?: Array<{ full_name: string }> }).repositories ?? []).map((r) => r.full_name) : [];
  const facts = await installationFacts(installationId, { fetchFn }).catch(() => ({ account: names[0]?.split('/')[0] ?? '', selection: 'selected' as const }));
  await ann.upsertInstallation({ installationId, account: facts.account, repos: names, selection: facts.selection, workspaceId });
}

// one token per installation per hour, in memory only: a burst of reads by one agent turn must not
// mint a token each (GitHub's own advice), and a row is where a token must never land
const tokens = new Map<number, { token: string; until: number }>();
export async function tokenFor(installationId: number, fetchFn: Fetch): Promise<string> {
  const hit = tokens.get(installationId);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await installationToken(installationId, { fetchFn });
  const until = (Date.parse(t.expiresAt) || Date.now() + 3_600_000) - 5 * 60_000;
  tokens.set(installationId, { token: t.token, until });
  return t.token;
}
export const forgetToken = (installationId: number): void => { tokens.delete(installationId); };

export type Resolve = { ok: true; handle: string } | { ok: false; code: 'NO_REPO' | 'NOT_INSTALLED'; error: string; slug: string | null };

/** can the App read the room's project's repository? Then the row exists, now. */
export async function resolveConnector(store: Store, ctx: { workspace: string; channel: string; actor: string }, fetchFn: Fetch): Promise<Resolve> {
  const ann = store.announcements!;
  const repo = await ann.primaryRepoForChannel(ctx.channel);
  const slug = repo ? slugOf(repo) : null;
  if (!repo) return { ok: false, code: 'NO_REPO', error: 'This project has no repository yet.', slug: null };
  if (!slug) return { ok: false, code: 'NO_REPO', error: `${repo.name} has no GitHub address. Attach the repository by its GitHub URL.`, slug: null };
  const inst = await installationFor(ann, slug, fetchFn, ctx.workspace).catch(() => null);
  if (!inst) return { ok: false, code: 'NOT_INSTALLED', error: `The neuramesh app is not installed on ${slug}.`, slug };
  const r = await githubGet(`/repos/${slug}`, { token: inst.token, fetchFn });
  if (r.status !== 200) return { ok: false, code: 'NOT_INSTALLED', error: `The neuramesh app cannot read ${slug}. Add the repository to the installation on GitHub.`, slug };
  await store.upsertConnector({ workspace: ctx.workspace, channelId: ctx.channel, provider: 'github', handle: slug, connectedBy: ctx.actor, scopes: GITHUB_SCOPES });
  return { ok: true, handle: slug };
}

const page = (title: string, lines: string[]): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#1d1d1d;color:#e6e6e6"><div style="text-align:center;max-width:36em">${lines.map((l) => `<p>${l}</p>`).join('')}</div></body>`;

const tryUnseal = (state: string): GrantState | null => {
  try { const s = unseal<Partial<GrantState>>(state); return s?.github === 1 && s.workspace && s.actor ? (s as GrantState) : null; } catch { return null; }
};

// ── the doors ──────────────────────────────────────────────────────────────────────────────────
/** `/connect/github/start` + `/connect/github/callback`: the in-app grant (sealed state) and the
 *  public door (slug state) on the same two routes. Mounted ABOVE the social `/connect/:provider/*`. */
export function githubConnectRoutes<E extends Env>(app: Hono<E>, store: Store, opts: { fetchFn?: Fetch } = {}): void {
  const fetchFn = opts.fetchFn ?? fetch;
  const ann = () => store.announcements;

  app.get('/connect/github/start', async (c) => {
    if (!githubAppConfigured()) return c.json({ error: 'the GitHub App is not configured on this server' }, 501);
    const workspace = c.req.query('workspace');
    const actor = c.req.query('actor');
    if (workspace && actor) {
      if (!process.env['NM_CONNECTOR_KEY'] || !ann()) return c.text('github connect is not configured on this server', 501);
      const channel = c.req.query('channel') ?? null;
      const repo = channel ? await ann()!.primaryRepoForChannel(channel) : null;
      const state: GrantState = { github: 1, workspace, channel, actor, slug: repo ? slugOf(repo) : null };
      return c.redirect(installUrl(seal(state)), 302);
    }
    const parsed = parseRepoInput(c.req.query('repo') ?? '');
    return c.redirect(installUrl(parsed?.slug ?? ''), 302);
  });

  app.get('/connect/github/callback', async (c) => {
    const id = Number(c.req.query('installation_id'));
    const raw = c.req.query('state') ?? '';
    const grant = tryUnseal(raw);
    if (grant) {
      if (!ann() || !githubAppConfigured() || !Number.isFinite(id) || id <= 0) return c.html(page('GitHub', ['The grant did not land.', 'Try again from Connections in neuramesh.']), 400);
      try {
        await rememberInstallation(ann()!, id, fetchFn, grant.workspace);
        const out = grant.channel ? await resolveConnector(store, { workspace: grant.workspace, channel: grant.channel, actor: grant.actor }, fetchFn) : null;
        if (out?.ok) return c.html(page('Connected', ['<span style="font-size:34px">✓</span>', `<b>${out.handle}</b> is connected.`, '<span style="color:#8f8f8f">Head back to neuramesh. The room already knows.</span>']));
        const why = out ? out.error : 'The installation is recorded.';
        return c.html(page('GitHub', [why, '<span style="color:#8f8f8f">Pick the repository on GitHub, then press Check again in neuramesh.</span>']));
      } catch (e) {
        console.warn(`github connect callback failed: ${e instanceof Error ? e.message : String(e)}`);
        return c.html(page('GitHub', ['The grant did not land.', 'Close this tab and try again from Connections in neuramesh.']), 400);
      }
    }
    // the public door: the state is the repository slug, and the person goes back to the site
    const slug = parseRepoInput(raw)?.slug ?? '';
    if (!ann() || !githubAppConfigured() || !Number.isFinite(id) || id <= 0) return c.redirect(`${APP_URL}/announce?granted=0`, 302);
    try { await rememberInstallation(ann()!, id, fetchFn, null); } catch (e) {
      console.warn(`github app callback failed: ${e instanceof Error ? e.message : String(e)}`);
      return c.redirect(`${APP_URL}/announce?granted=0${slug ? `&repo=${encodeURIComponent(slug)}` : ''}`, 302);
    }
    return c.redirect(`${APP_URL}/announce?granted=1${slug ? `&repo=${encodeURIComponent(slug)}` : ''}`, 302);
  });
}

// ── the /v1 lane: the resolve and the reads (after the guard: the actor is known) ─────────────
type Opened = { slug: string; token: string; repo: PrimaryRepo; connId: string };
type Refusal = { status: 400 | 403 | 409 | 501 | 502; body: { error: string; code: string } };

export function githubApiRoutes<E extends ActorEnv>(app: Hono<E>, store: Store, opts: { fetchFn?: Fetch } = {}): void {
  const fetchFn = opts.fetchFn ?? fetch;
  const ann = () => store.announcements;

  app.post('/v1/github/resolve', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'a person connects GitHub', code: 'HUMAN_ONLY' }, 403);
    const body = z.object({ channel: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', code: 'INVALID_INPUT' }, 400);
    if (!githubAppConfigured() || !ann()) return c.json({ ok: false, code: 'NOT_CONFIGURED', error: 'GitHub connecting is not configured on this server.' });
    const repo = await ann()!.primaryRepoForChannel(body.data.channel);
    if (!repo) return c.json({ ok: false, code: 'NO_REPO', error: 'This project has no repository yet.' });
    if (!(await actorInWorkspace(store, actor, repo.workspaceId))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const out = await resolveConnector(store, { workspace: repo.workspaceId, channel: body.data.channel, actor: actor.id }, fetchFn);
    if (out.ok) return c.json({ ok: true, handle: out.handle });
    const state: GrantState = { github: 1, workspace: repo.workspaceId, channel: body.data.channel, actor: actor.id, slug: out.slug };
    return c.json({ ok: false, code: out.code, error: out.error, install: out.code === 'NOT_INSTALLED' && process.env['NM_CONNECTOR_KEY'] ? installUrl(seal(state)) : null });
  });

  /** the ACL, once, for every read: the room → its project's repository → the connected row → a token */
  const open = async (c: { req: { query: (k: string) => string | undefined }; get: (k: 'actor') => Actor }): Promise<Opened | Refusal> => {
    const channel = c.req.query('channel');
    if (!channel) return { status: 400, body: { error: 'channel is required', code: 'INVALID_INPUT' } };
    if (!githubAppConfigured() || !ann()) return { status: 501, body: { error: 'GitHub connecting is not configured on this server', code: 'NOT_CONFIGURED' } };
    const repo = await ann()!.primaryRepoForChannel(channel);
    const slug = repo ? slugOf(repo) : null;
    if (!repo || !slug) return { status: 409, body: { error: 'this room\'s project has no GitHub repository', code: 'NO_REPO' } };
    if (!(await actorInWorkspace(store, c.get('actor'), repo.workspaceId))) return { status: 403, body: { error: 'not your workspace', code: 'NOT_PERMITTED' } };
    const conn = await store.connectorWithSecret(repo.workspaceId, 'github', channel);
    if (!conn) return { status: 409, body: { error: 'GitHub is not connected for this room', code: 'NOT_CONNECTED' } };
    const reconnect: Refusal = { status: 409, body: { error: `GitHub no longer lets neuramesh read ${slug}. A person needs to connect GitHub again from Connections.`, code: 'RECONNECT_REQUIRED' } };
    if (conn.status !== 'connected') return reconnect;
    try {
      // a deleted installation answers 404 on the token mint and GitHub names no other: the grant is
      // gone, and the row says so
      const inst = await installationFor(ann()!, slug, fetchFn);
      if (!inst) { await store.markConnectorReauth(conn.id); return reconnect; }
      return { slug, token: inst.token, repo, connId: conn.id };
    } catch (e) {
      if (e instanceof GitHubApiError && (e.status === 401 || e.status === 403)) { await store.markConnectorReauth(conn.id); return reconnect; }
      return { status: 502, body: { error: e instanceof Error ? e.message : 'GitHub did not answer', code: 'GITHUB_ERROR' } };
    }
  };
  const isRefusal = (o: Opened | Refusal): o is Refusal => 'status' in o;
  const failed = (e: unknown): Refusal => e instanceof GitHubApiError && e.status >= 400 && e.status < 500
    ? { status: 400, body: { error: e.message, code: e.status === 404 ? 'NOT_FOUND' : 'INVALID_INPUT' } }
    : { status: 502, body: { error: e instanceof Error ? e.message : 'GitHub did not answer', code: 'GITHUB_ERROR' } };

  app.get('/v1/repo/changes', async (c) => {
    const o = await open(c);
    if (isRefusal(o)) return c.json(o.body, o.status);
    const since = c.req.query('since') || new Date(Date.now() - 30 * 86_400_000).toISOString();
    try {
      const signals = await readRepoSignals(o.slug, since, { token: o.token, fetchFn });
      const commits = await readRepoCommits(o.slug, since, signals.repo.defaultBranch, { token: o.token, fetchFn });
      return c.json({ slug: o.slug, since, ...signals, commits });
    } catch (e) { const f = failed(e); return c.json(f.body, f.status); }
  });

  app.get('/v1/repo/file', async (c) => {
    const o = await open(c);
    if (isRefusal(o)) return c.json(o.body, o.status);
    try { return c.json({ slug: o.slug, ...(await readRepoFile(o.slug, c.req.query('path') ?? '', c.req.query('ref') || null, { token: o.token, fetchFn })) }); }
    catch (e) { const f = failed(e); return c.json(f.body, f.status); }
  });

  app.get('/v1/repo/tree', async (c) => {
    const o = await open(c);
    if (isRefusal(o)) return c.json(o.body, o.status);
    try { return c.json({ slug: o.slug, ...(await readRepoTree(o.slug, c.req.query('path') ?? '', c.req.query('ref') || null, { token: o.token, fetchFn })) }); }
    catch (e) { const f = failed(e); return c.json(f.body, f.status); }
  });
}
