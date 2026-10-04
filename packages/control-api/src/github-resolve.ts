// The GitHub connector's resolver (docs/design/github-connector-2026-09, plan §7): can the App read
// the room's repository now, and which one? The grant is the first move on every surface, so the
// resolve answers from what the App reads for the workspace, not from what the project already names:
//   - the project names a repository with a GitHub address the App reads → the row, connected;
//   - the App reads one or several → the answer lists them (the pick), with the row whose name
//     matches the project's folder as the hint; the pick sends the slug back and lands in the first
//     case. Only the pick attaches: the install callback records the installation and nothing else,
//     because its state and its installation_id prove no person (the step pre-selects the one
//     repository a fresh grant reads, so that costs one click);
//   - the App reads none for this workspace → nothing to pick from: the grant. A grant that no
//     workspace recorded (the public door's, or a read's repair) gets words that name the way out.
// The installation helpers (the verified lookup, the memo, the hourly token) live here too, shared by
// the routes (github-connect.ts) and the public announce door.
import { createEvent, formatAddress } from '@neuramesh/shared';
import { GitHubApiError, findInstallation, githubAppConfigured, githubGet, installationToken, parseRepoInput } from './github-app';
import { installationFacts } from './github-reads';
import type { Store } from './store';
import { hasGitHubAddress, type AnnounceStore, type Installation, type PrimaryRepo } from './store/announce';
import { resumeAfterGitHub } from './github-resume';

type Fetch = typeof fetch;
export const GITHUB_SCOPES = 'metadata:read contents:read pull_requests:read';

/** `owner/repo` for a repository row: the clone URL first (the daemon's own order), else org/name; a
 *  locally attached checkout (`org_name = 'local'`, no URL) has no GitHub side to read */
export function slugOf(repo: PrimaryRepo): string | null {
  const fromUrl = repo.cloneUrl ? parseRepoInput(repo.cloneUrl)?.slug ?? null : null;
  if (fromUrl) return fromUrl;
  if (!hasGitHubAddress(repo) || !repo.orgName || !repo.name) return null;
  return `${repo.orgName}/${repo.name}`;
}

/** the App's installation for a repository, VERIFIED: the table's row must still mint a token (a
 *  row GitHub answers 404 for is dead and forgotten: the live harness held a fake id for the same
 *  repository and it won the lookup), else GitHub's own answer, remembered with the installation's
 *  repository list. The token comes back with it, so a caller never mints twice. */
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

const PAGE = 100;   // GitHub's largest page
/** what GitHub says the installation covers, written down (account, selection, the first page of
 *  repositories) and returned: the repositories, lowercased slugs */
export async function rememberInstallation(ann: AnnounceStore, installationId: number, fetchFn: Fetch, workspaceId: string | null): Promise<string[]> {
  const tok = await tokenFor(installationId, fetchFn);
  const repos = await githubGet(`/installation/repositories?per_page=${PAGE}`, { token: tok, fetchFn });
  const names = repos.status === 200 ? ((repos.json as { repositories?: Array<{ full_name: string }> }).repositories ?? []).map((r) => r.full_name.toLowerCase()) : [];
  const facts = await installationFacts(installationId, { fetchFn }).catch(() => ({ account: names[0]?.split('/')[0] ?? '', selection: 'selected' as const }));
  await ann.upsertInstallation({ installationId, account: facts.account, repos: names, selection: facts.selection, workspaceId });
  return names;
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

/** every repository the App reads for this workspace, refreshed from GitHub installation by
 *  installation (one cached token, one list call each); a dead installation is forgotten */
export async function readableRepos(ann: AnnounceStore, workspaceId: string, fetchFn: Fetch): Promise<string[]> {
  const out = new Set<string>();
  for (const row of await ann.installationsForWorkspace(workspaceId)) {
    try { for (const s of await rememberInstallation(ann, row.installationId, fetchFn, workspaceId)) out.add(s); }
    catch (e) {
      forgetToken(row.installationId);
      if (e instanceof GitHubApiError && e.status === 404) await ann.forgetInstallation(row.installationId).catch(() => {});
      else for (const s of row.repos) out.add(s);   // GitHub did not answer: the memo stands for this turn
    }
  }
  return [...out].sort();
}

/** the pre-selection: the readable repository whose name is the project's folder name */
export const hintFor = (repo: PrimaryRepo | null, repos: string[]): string | null =>
  (repo && repos.find((s) => s.split('/')[1] === repo.name.toLowerCase())) ?? null;

/** the attach: the same row `repo.link` writes (repos + project_repos, primary when the project has
 *  no primary), the channel naming the project */
async function attachRepo(store: Store, ctx: { workspace: string; channel: string; actor: string }, slug: string, defaultBranch: string): Promise<void> {
  const [orgName = '', name = ''] = slug.split('/');
  const event = createEvent({
    type: 'repo.linked', source: formatAddress({ kind: 'human', id: ctx.actor }),
    target: formatAddress({ kind: 'resource', type: 'repo', id: `${orgName}-${name}`.replace(/[^A-Za-z0-9._-]/g, '-') }),
    workspace: ctx.workspace, payload: { orgName, name, provider: 'github', channel: ctx.channel, door: 'github-app' },
  });
  await store.linkRepo({ workspace: ctx.workspace, channel: ctx.channel, project: null, provider: 'github', orgName, name, defaultBranch, cloneUrl: `https://github.com/${slug}.git`, localPath: null }, event);
}

export type Resolve =
  | { ok: true; handle: string; attached: boolean }
  | { ok: false; code: 'NO_REPO' | 'NOT_INSTALLED'; error: string; slug: string | null; repos: string[]; hint: string | null };

/** can the App read the room's project's repository? Then the row exists, now. `pick`: the human
 *  chose one of the readable repositories, attached and connected in one move. `resume`: the /v1
 *  resolve, which proves the person, resumes the project's open GitHub cards. */
export async function resolveConnector(store: Store, ctx: { workspace: string; channel: string; actor: string }, fetchFn: Fetch, opts: { pick?: string | null; resume?: boolean } = {}): Promise<Resolve> {
  const pick = opts.pick ?? null;
  const ann = store.announcements!;
  const repo = await ann.repoForChannel(ctx.channel);
  const slug = repo ? slugOf(repo) : null;
  let refreshed: Promise<string[]> | null = null;   // one refresh from GitHub per resolve
  const readable = (): Promise<string[]> => (refreshed ??= readableRepos(ann, ctx.workspace, fetchFn));
  // only an installation recorded for THIS workspace connects a repository: the GitHub-wide lookup
  // (installationFor) answers for any workspace's grant, and its fallback stamps the grant onto
  // the caller's workspace
  const installed = async (target: string): Promise<number | null> => {
    const t = target.toLowerCase();
    const covers = (i: Installation): boolean => i.repos.includes(t) || (i.selection === 'all' && i.account.toLowerCase() === t.split('/')[0]);
    const known = (await ann.installationsForWorkspace(ctx.workspace)).find(covers);
    if (known) return known.installationId;
    await readable();
    const rows = await ann.installationsForWorkspace(ctx.workspace);
    const hit = rows.find(covers);
    if (hit) return hit.installationId;
    // a stored list is GitHub's first page only: past a full one, GitHub's own answer counts, for an
    // installation of this workspace alone, and nothing is written for the caller
    if (!rows.some((i) => i.repos.length >= PAGE)) return null;
    const found = await findInstallation(target, { fetchFn }).catch(() => null);
    return found && rows.some((i) => i.installationId === found.id) ? found.id : null;
  };
  const connect = async (target: string): Promise<{ facts: { default_branch?: string } } | null> => {
    const id = await installed(target).catch(() => null);
    const token = id === null ? null : await tokenFor(id, fetchFn).catch(() => null);
    if (!token) return null;
    const r = await githubGet(`/repos/${target}`, { token, fetchFn });
    return r.status === 200 ? { facts: r.json as { default_branch?: string } } : null;
  };
  // a connection this project already holds keeps answering: the reads (github-connect.ts open()) serve
  // it through any installation, so a room whose grant was recorded before the scoping never strands
  const holds = async (target: string): Promise<boolean> => {
    const row = await store.connectorWithSecret(ctx.workspace, 'github', ctx.channel).catch(() => null);
    if (row?.status !== 'connected' || row.handle.toLowerCase() !== target.toLowerCase()) return false;
    const inst = await installationFor(ann, target, fetchFn).catch(() => null);
    return !!inst && (await githubGet(`/repos/${target}`, { token: inst.token, fetchFn }).catch(() => null))?.status === 200;
  };
  // a live grant that no workspace recorded (the public door's, or a read's repair after a reinstall
  // on GitHub's own pages): GitHub sends no callback for an installation that exists already, so the
  // grant door alone never connects it. Another workspace's grant keeps the plain words.
  const stranded = async (target: string): Promise<string | null> => {
    if (await installed(target).then((id) => id !== null, () => true)) return null;   // this workspace's own grant, or no answer
    const door = await ann.installationForRepo(target, { unrecorded: true }).catch(() => null);
    const live = door && await tokenFor(door.installationId, fetchFn).then(() => true, async (e: unknown) => {
      if (e instanceof GitHubApiError && e.status === 404) await ann.forgetInstallation(door.installationId).catch(() => {});
      return false;
    });
    return live ? `The neuramesh app reads ${target}, but this workspace did not install it. On GitHub, uninstall the neuramesh app from ${target.split('/')[0]}, then grant access again here.` : null;
  };
  const written = async (target: string, attached: boolean): Promise<Resolve> => {
    await store.upsertConnector({ workspace: ctx.workspace, channelId: ctx.channel, provider: 'github', handle: target, connectedBy: ctx.actor, scopes: GITHUB_SCOPES });
    // the grant arms the work: every open GitHub card in the project resumes (github-resume.ts), and
    // only from the /v1 resolve, because only its session proves the person
    if (opts.resume) await resumeAfterGitHub(store, ctx, target).catch((e) => console.warn(`github resume failed: ${e instanceof Error ? e.message : String(e)}`));
    return { ok: true, handle: target, attached };
  };
  if (pick) {
    const target = parseRepoInput(pick)?.slug ?? null;
    const read = target ? await connect(target) : null;
    if (!target || !read) return { ok: false, code: 'NOT_INSTALLED', error: (target && await stranded(target)) || `The neuramesh app cannot read ${target ?? pick}. Add the repository on GitHub, then pick it.`, slug: target, repos: await readable(), hint: null };
    if (target !== slug) await attachRepo(store, ctx, target, read.facts.default_branch || 'main');
    return written(target, target !== slug);
  }
  if (slug && (await connect(slug) || await holds(slug))) return written(slug, false);
  const repos = await readable();
  const hint = hintFor(repo, repos);
  if (!repo) return { ok: false, code: 'NO_REPO', error: repos.length ? 'Pick the repository this project lives in.' : 'This project has no repository yet. Grant access on GitHub and pick it there.', slug: null, repos, hint };
  if (!slug) return { ok: false, code: 'NO_REPO', error: repos.length ? `Pick the repository ${repo.name} lives in.` : `${repo.name} is a folder on a machine. Grant access on GitHub and pick its repository there.`, slug: null, repos, hint };
  const error = await stranded(slug) ?? (repos.length ? `The neuramesh app cannot read ${slug}. Add it on GitHub, or pick another repository.` : `The neuramesh app is not installed on ${slug}. Grant access on GitHub.`);
  return { ok: false, code: 'NOT_INSTALLED', error, slug, repos, hint };
}
