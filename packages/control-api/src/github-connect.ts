// GitHub as a connector (docs/design/github-connector-2026-09): the platform's GitHub App as a
// per-project READ connector, and the reads the agents' tools ride.
//
// Custody, said plainly: the App's private key stays on the server, an installation token is minted
// per read (cached in memory for its hour, never written to a row), and a machine sees content,
// never a credential. The `connectors` row (provider 'github', handle = the repository slug) is the
// ACL: no row, no read. GitHub's refusal of the installation (removed on GitHub) marks the row
// `reauth_required`, the same verdict a dead social grant gets, so the attention bar lights.
//
// One door writes the row: `POST /v1/github/resolve` (the app asks whether the App can read the
// room's repository now, and the row is written when it can). The install callback (the sealed
// state names the workspace, the room and the person, the social flows' idiom) only records the
// installation for that workspace: the start URL is public and GitHub does not sign installation_id,
// so the callback proves no person, and it attaches nothing, writes no row and resumes nothing. The
// resolve reads only the installations recorded for the room's workspace, never GitHub's answer for
// any workspace's grant, so a grant whose callback lands on a deployment with another database does
// not count here. The public announce door keeps its slug-state branch on the same routes.
//
// The owner proof (docs/design/github-owner-proof-2026-10), on when ownerProofConfigured(): every grant
// starts at GitHub's authorize page, and the signed-in prove call (`POST /v1/github/prove`,
// github-prove.ts) is the second door that writes. Only the signed-in resolve seals a grant's state, so
// the state names the session's person: the public start sends the browser to hq's start page, which
// asks the resolve. The Setup URL only sends the browser on (it records nothing), and the resolve
// connects only a repository in the asking person's fresh proof. Off, every door works as above.
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { seal, unseal } from './connector-crypto';
import { actorInWorkspace } from './credits';
import { GitHubApiError, githubAppConfigured, installUrl, parseRepoInput, readRepoSignals } from './github-app';
import { authorizeUrl, grantStartUrl, isProofState, ownerProofConfigured, sealProofState, type GrantState } from './github-proof';
import { proveGrant } from './github-prove';
import { readRepoCommits, readRepoFile, readRepoImage, readRepoTree } from './github-reads';
import { installationFor, rememberInstallation, resolveConnector, slugOf } from './github-resolve';
import { githubWriteRoutes } from './github-write';
import { APP_URL, HQ_URL } from './mail';
import { shelfCopy } from './shelf-image';
import type { Store } from './store';
import { setArtifactSource } from './store/frames';
import type { PrimaryRepo } from './store/announce';

// the resolver and the installation helpers moved to github-resolve.ts (plan §7); the same names
export { GITHUB_SCOPES, forgetToken, installationFor, rememberInstallation, resolveConnector, slugOf, tokenFor, type Resolve } from './github-resolve';

type Fetch = typeof fetch;
type ActorEnv = Env & { Variables: { actor: Actor } };

const page = (title: string, lines: string[]): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#1d1d1d;color:#e6e6e6"><div style="text-align:center;max-width:36em">${lines.map((l) => `<p>${l}</p>`).join('')}</div></body>`;

// a proof state (`w.` or `p.`) reads as a plain in-app state when the proof is off again: every door works as before
const tryUnseal = (state: string): GrantState | null => {
  try { const s = unseal<Partial<GrantState>>(state.replace(/^[wp]\./, '')); return s?.github === 1 && s.workspace && s.actor ? (s as GrantState) : null; } catch { return null; }
};

/** the Setup URL with the proof on: GitHub's error and a member's request end on hq's page, which asks
 *  the prove call for the words; an install or an update goes on to the authorize page. Same state. */
const setupHop = (state: string, action: string | undefined, error: string | undefined): string => {
  const ended = error ? error.replace(/[^\w-]/g, '').slice(0, 60) || 'error' : action === 'request' ? 'request' : null;
  return ended ? `${HQ_URL}/github/callback?${new URLSearchParams({ error: ended, state }).toString()}` : authorizeUrl(state);
};

// ── the doors ──────────────────────────────────────────────────────────────────────────────────
/** `/connect/github/start` + `/connect/github/callback`: the in-app grant (sealed state) and the
 *  public door (slug state) on the same two routes. Mounted ABOVE the social `/connect/:provider/*`. */
export function githubConnectRoutes<E extends Env>(app: Hono<E>, store: Store, opts: { fetchFn?: Fetch } = {}): void {
  const fetchFn = opts.fetchFn ?? fetch;
  const ann = () => store.announcements;
  githubWriteRoutes(app, store, fetchFn); // POST /v1/repo/token, a machine's per-run write token (github-write.ts)

  app.get('/connect/github/start', async (c) => {
    if (!githubAppConfigured()) return c.json({ error: 'the GitHub App is not configured on this server' }, 501);
    const workspace = c.req.query('workspace');
    const actor = c.req.query('actor');
    if (workspace && actor) {
      const channel = c.req.query('channel') ?? null;
      // the supported desktops open this start with no session. With the proof on, the query proves nobody,
      // so nothing here names a person: hq's start page asks the signed-in resolve for the grant link
      if (ownerProofConfigured()) return c.redirect(grantStartUrl(channel || null), 302);
      if (!process.env['NM_CONNECTOR_KEY'] || !ann()) return c.text('github connect is not configured on this server', 501);
      const repo = channel ? await ann()!.repoForChannel(channel) : null;
      const state: GrantState = { github: 1, workspace, channel, actor, slug: repo ? slugOf(repo) : null };
      return c.redirect(installUrl(seal(state)), 302);
    }
    const parsed = parseRepoInput(c.req.query('repo') ?? '');
    return c.redirect(installUrl(parsed?.slug ?? ''), 302);
  });

  app.get('/connect/github/callback', async (c) => {
    const id = Number(c.req.query('installation_id'));
    const raw = c.req.query('state') ?? '';
    // the owner proof: GitHub does not sign installation_id, so this route records nothing for a grant
    if (ownerProofConfigured() && isProofState(raw)) return c.redirect(setupHop(raw, c.req.query('setup_action'), c.req.query('error')), 302);
    const grant = tryUnseal(raw);
    if (grant) {
      if (ownerProofConfigured()) return c.html(page('GitHub', ['The grant did not land.', 'Start again from neuramesh.']), 400);
      if (!ann() || !githubAppConfigured() || !Number.isFinite(id) || id <= 0) return c.html(page('GitHub', ['The grant did not land.', 'Try again from Connections in neuramesh.']), 400);
      try {
        // the record only: the state and the installation_id prove no person, so the row, the attach
        // and the resume wait for the signed-in resolve, which the step asks every 5 s
        const names = await rememberInstallation(ann()!, id, fetchFn, grant.workspace);
        if (!names.length) return c.html(page('GitHub', ['The neuramesh app reads no repository yet.', '<span style="color:#8f8f8f">Pick the repository on GitHub, then press Check again in neuramesh.</span>']));
        return c.html(page('GitHub', ['<span style="font-size:34px">✓</span>', `The neuramesh app reads ${names.length === 1 ? `<b>${names[0]}</b>` : `${names.length} repositories`}.`, '<span style="color:#8f8f8f">Return to neuramesh to finish.</span>']));
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
/** the next move is GitHub's authorize page: the person holds no fresh proof, or one that does not connect
 *  the room's own repository (GitHub may read it for the person since the proof) */
const proveWords = (slug: string | null): string => slug
  ? `GitHub must confirm that your account can read ${slug}. Grant access on GitHub.`
  : 'GitHub must confirm which repositories your account can read. Grant access on GitHub.';
type Opened = { slug: string; token: string; repo: PrimaryRepo; connId: string };
type Refusal = { status: 400 | 403 | 409 | 501 | 502; body: { error: string; code: string } };

export function githubApiRoutes<E extends ActorEnv>(app: Hono<E>, store: Store, opts: { fetchFn?: Fetch } = {}): void {
  const fetchFn = opts.fetchFn ?? fetch;
  const ann = () => store.announcements;

  app.post('/v1/github/resolve', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'a person connects GitHub', code: 'HUMAN_ONLY' }, 403);
    const body = z.object({ channel: z.string().min(1), repo: z.string().min(1).optional(), client: z.string().nullish() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', code: 'INVALID_INPUT' }, 400);
    if (!githubAppConfigured() || !ann()) return c.json({ ok: false, code: 'NOT_CONFIGURED', error: 'GitHub connecting is not configured on this server.' });
    // the room names the workspace, not the repository: a project with no repository resolves too
    const { workspace } = await store.channelWorkspace(body.data.channel).catch(() => ({ workspace: null as string | null }));
    if (!workspace) return c.json({ error: 'channel not found', code: 'NOT_FOUND' }, 404);
    if (!(await actorInWorkspace(store, actor, workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    // the owner proof: only the asking person's fresh proof connects, on the person's pick or the grant the person
    // started, and the next move is GitHub's authorize page
    const proofs = ownerProofConfigured() && store.githubProofs ? await store.githubProofs.fresh(workspace, actor.id) : null;
    const out = await resolveConnector(store, { workspace, channel: body.data.channel, actor: actor.id }, fetchFn, { pick: body.data.repo ?? null, resume: true, proofs });
    if (out.ok) return c.json({ ok: true, handle: out.handle, attached: out.attached });
    const state: GrantState = { github: 1, workspace, channel: body.data.channel, actor: actor.id, slug: out.slug };
    if (proofs) {
      const sealed = sealProofState(body.data.client === 'phone' ? 'p' : 'w', state);
      // a pick that does not connect keeps its own answer: the person named that repository. a proof that reads the
      // room's repository keeps the pick too: the person connects it with one click (resolveConnector)
      const prove = !proofs.length || (out.code === 'NOT_INSTALLED' && !body.data.repo && !out.proven);
      return c.json({ ok: false, code: prove ? 'PROVE' : out.code, error: prove ? proveWords(proofs.length ? out.slug : null) : out.error, repos: out.repos, hint: out.hint, install: installUrl(sealed), authorize: authorizeUrl(sealed) });
    }
    return c.json({ ok: false, code: out.code, error: out.error, repos: out.repos, hint: out.hint, install: process.env['NM_CONNECTOR_KEY'] ? installUrl(seal(state)) : null, authorize: null });
  });

  // the owner proof's second leg (github-prove.ts): GitHub's code, sent back with the person's own session
  app.post('/v1/github/prove', async (c) => c.json(await proveGrant(store, c.get('actor'), await c.req.json().catch(() => null), fetchFn)));

  /** the ACL, once, for every read: the room → its project's repository → the connected row → a token */
  const open = async (c: { req: { query: (k: string) => string | undefined }; get: (k: 'actor') => Actor }): Promise<Opened | Refusal> => {
    const channel = c.req.query('channel');
    if (!channel) return { status: 400, body: { error: 'channel is required', code: 'INVALID_INPUT' } };
    if (!githubAppConfigured() || !ann()) return { status: 501, body: { error: 'GitHub connecting is not configured on this server', code: 'NOT_CONFIGURED' } };
    const repo = await ann()!.repoForChannel(channel);
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

  // AN APP SCREENSHOT FROM THE CODE (George, 2026-10-06: "an actual screenshot of the app from our
  // codebase or workspace files"). An agent names one image file of the room's repository, and the
  // platform reads it through the App, makes the shelf copy and shelves it in the room as the
  // platform's copy of that file (`source` repo:…, store/frames.ts). That mark is what lets a film
  // show an image an agent asked for: the agent never handles the bytes, so a web capture or a drawn
  // picture can never pass as the app.
  app.post('/v1/repo/shelve', async (c) => {
    const o = await open(c);
    if (isRefusal(o)) return c.json(o.body, o.status);
    const body = z.object({ path: z.string().trim().min(1).max(400), name: z.string().trim().min(1).max(120).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name the image file: { path, name? }', code: 'INVALID_INPUT' }, 400);
    const channel = c.req.query('channel')!;
    const actor = c.get('actor');
    try {
      const img = await readRepoImage(o.slug, body.data.path, { token: o.token, fetchFn });
      const copy = await shelfCopy(img.bytes, img.mime);
      if (!copy) return c.json({ error: `${img.path} does not fit the shelf at any size. Pick a PNG or JPEG screenshot.`, code: 'TOO_LARGE' }, 413);
      const leaf = img.path.split('/').pop()!;
      const name = (body.data.name ?? leaf).replace(/\.(png|jpe?g|webp)$/i, '') + (copy.mime === 'image/jpeg' ? '.jpg' : leaf.slice(leaf.lastIndexOf('.')));
      const { id } = await store.createChannelArtifact(
        { channelId: channel, kind: 'file', name, inlineContent: copy.dataUrl, mime: copy.mime, createdByKind: actor.kind, createdBy: actor.id },
        (ws) => createEvent({ type: 'artifact.created', source: formatAddress({ kind: actor.kind, id: actor.id }), target: formatAddress({ kind: 'channel', slug: channel }), workspace: ws, payload: { channel, name, kind: 'file', from: `${o.slug}/${img.path}` } }),
      );
      await setArtifactSource(store, id, `repo:${o.slug}/${img.path}@${img.sha}`);
      return c.json({ ok: true, id, name, path: img.path, sha: img.sha }, 201);
    } catch (e) { const f = failed(e); return c.json(f.body, f.status); }
  });
}
