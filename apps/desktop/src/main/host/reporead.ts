// ONE repository read for the agents (docs/design/github-connector-2026-09 §3.3): the agent-facing
// rendering of /v1/repo/* (the connector door: the App reads server-side, the machine sees content
// and never a credential) with the machine's own gh as the second door, so the local app reads its
// repositories without the App and a cloud machine reads through the grant. The orchestrator
// registry, the chat registry and the worker bus all call these three functions: a drifted copy is
// how one surface starts inventing a CHANGELOG while another refuses. Both doors normalise to the
// server's wire shape, so there is one renderer per read.
import type { ScanPr, ScanRelease, ScanTag } from '@neuramesh/shared';
import type { ApiGetFn } from './searchx';
import { ghCapable, ghRaw, repoSlugFor } from './gh';
import { readRepoSignals as readSignalsViaGh, type RepoSignals } from './releasewatch';

type ReplicaDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };
type ActorRef = { kind: string; id: string; role?: string };
interface Commit { sha: string; message: string; date: string | null; author: string | null; url: string }
interface Changes extends RepoSignals { slug: string; since: string; commits: Commit[]; repo?: { defaultBranch: string; private: boolean } }
interface FileOut { slug: string; path: string; ref: string | null; size: number; content: string; truncated: boolean }
interface TreeOut { slug: string; ref: string; path: string; entries: Array<{ path: string; type: 'blob' | 'tree'; size: number | null }>; truncated: boolean }

export interface RepoReader {
  changes(i: { since?: string }): Promise<string>;
  file(i: { path: string; ref?: string }): Promise<string>;
  tree(i: { path?: string; ref?: string }): Promise<string>;
}

const FILE_TEXT_CAP = 60_000;
const TREE_CAP = 500;
const NOT_CONNECTED = 'This room cannot read its repository: GitHub is not connected for this project and this machine has no GitHub login. Say so plainly and point the human at Connections › GitHub (one minute on GitHub, read only). For a playbook ask, still call run_playbook: it posts the Connect GitHub card the human can click. Never guess what the repository contains.';
const NO_REPO = 'This room\'s project has no GitHub repository attached. Say so plainly: the human attaches one in the project (Attach the repository), then asks again.';
const RECONNECT = 'GitHub no longer lets neuramesh read this repository: the grant ended on GitHub. Tell the human plainly to connect GitHub again from Connections. Do not retry, and never fill the gap with guesses.';

/** the room's primary repository from the replica (the release preflight's own order) */
export async function primaryRepoRow(db: ReplicaDb, channelId: string): Promise<{ id: string; org_name: string; name: string; clone_url: string | null; local_path: string | null; provider: string | null } | null> {
  const rows = await db.getAll<{ id: string; org_name: string; name: string; clone_url: string | null; local_path: string | null; provider: string | null }>(
    `select r.id, r.org_name, r.name, r.clone_url, r.local_path, r.provider from repos r
       join project_repos pr on pr.repo_id = r.id join channels c on c.project_id = pr.project_id
      where c.id = ? order by coalesce(pr.is_primary, 0) desc, r.org_name, r.name limit 1`, [channelId]).catch(() => []);
  return rows[0] ?? null;
}

/** is the room's project's GitHub connector live, from the replica */
export async function githubConnected(db: ReplicaDb, channelId: string): Promise<boolean> {
  const rows = await db.getAll<{ n: number }>(
    `select count(*) as n from connectors k join channels c on c.id = ? and c.project_id = k.project_id where k.provider = 'github' and k.status = 'connected'`, [channelId]).catch(() => []);
  return (rows[0]?.n ?? 0) > 0;
}

// ── the connector door ─────────────────────────────────────────────────────────────────────────
type ApiOut<T> = { ok: true; body: T } | { ok: false; code: string; error: string; status: number };
async function viaApi<T>(apiGet: ApiGetFn, actor: ActorRef, path: string, params: Record<string, string | undefined>): Promise<ApiOut<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const res = await apiGet(`/v1/repo/${path}?${qs.toString()}`, actor);
  const body = (await res.json().catch(() => ({}))) as T & { code?: string; error?: string };
  if (res.ok) return { ok: true, body };
  return { ok: false, code: body.code ?? 'ERROR', error: body.error ?? `read failed (${res.status})`, status: res.status };
}

/** the release watch's read through the connector: the signals, or null when this room has no live grant */
export async function readSignalsViaConnector(apiGet: ApiGetFn, actor: ActorRef, channelId: string, since: string): Promise<RepoSignals | null> {
  const r = await viaApi<Changes>(apiGet, actor, 'changes', { channel: channelId, since });
  if (!r.ok) {
    if (r.code === 'NOT_CONNECTED' || r.code === 'NO_REPO' || r.code === 'NOT_CONFIGURED' || r.code === 'RECONNECT_REQUIRED') return null;
    throw new Error(`the connector could not read the repository: ${r.error}`);
  }
  return { releases: r.body.releases, prs: r.body.prs, tags: r.body.tags };
}

// ── the gh door ────────────────────────────────────────────────────────────────────────────────
async function ghJson<T>(args: string[]): Promise<{ ok: true; json: T } | { ok: false; error: string }> {
  const r = await ghRaw(['api', ...args]);
  if (!r.ok) return { ok: false, error: r.stderr.split('\n')[0] || `gh exit ${r.code}` };
  try { return { ok: true, json: JSON.parse(r.stdout || 'null') as T }; } catch { return { ok: false, error: 'gh answered something that is not JSON' }; }
}
const cleanPath = (p: string | undefined): string => String(p ?? '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');

async function ghChanges(slug: string, since: string): Promise<Changes> {
  const signals = await readSignalsViaGh(slug, since);
  const c = await ghJson<Array<{ sha: string; html_url: string; commit?: { message?: string; author?: { date?: string; name?: string } }; author?: { login?: string } | null }>>([`repos/${slug}/commits?since=${encodeURIComponent(since)}&per_page=50`]);
  const commits: Commit[] = c.ok && Array.isArray(c.json) ? c.json.map((x) => ({ sha: x.sha, message: (x.commit?.message ?? '').split('\n')[0] ?? '', date: x.commit?.author?.date ?? null, author: x.author?.login ?? x.commit?.author?.name ?? null, url: x.html_url })) : [];
  return { slug, since, ...signals, commits };
}
async function ghFile(slug: string, path: string, ref: string | undefined): Promise<FileOut | string> {
  const p = cleanPath(path);
  if (!p) return 'name a file path';
  const r = await ghJson<{ type?: string; size?: number; encoding?: string; content?: string } | unknown[]>([`repos/${slug}/contents/${p}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`]);
  if (!r.ok) return `no file at ${p}: ${r.error}`;
  if (Array.isArray(r.json)) return `${p} is a directory: list it with list_repo_files`;
  const b = r.json as { type?: string; size?: number; encoding?: string; content?: string };
  if (b.type !== 'file' || b.encoding !== 'base64' || typeof b.content !== 'string') return `${p} is not a readable file (larger than 1 MB, or not a file)`;
  const buf = Buffer.from(b.content.replace(/\n/g, ''), 'base64');
  if (buf.subarray(0, 8000).includes(0)) return `${p} is a binary file`;
  const text = buf.toString('utf8');
  return { slug, path: p, ref: ref ?? null, size: b.size ?? buf.length, content: text.slice(0, FILE_TEXT_CAP), truncated: text.length > FILE_TEXT_CAP };
}
async function ghTree(slug: string, path: string | undefined, ref: string | undefined): Promise<TreeOut | string> {
  const p = cleanPath(path);
  const at = ref || 'HEAD';
  const r = await ghJson<{ tree?: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>([`repos/${slug}/git/trees/${encodeURIComponent(at)}?recursive=1`]);
  if (!r.ok) return `no tree at ${at}: ${r.error}`;
  const prefix = p ? `${p}/` : '';
  const rows = (r.json.tree ?? []).filter((e) => (e.type === 'blob' || e.type === 'tree') && (!prefix || e.path.startsWith(prefix)));
  if (p && !rows.length) return `no directory at ${p}`;
  return { slug, ref: at, path: p, entries: rows.slice(0, TREE_CAP).map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.type === 'blob' ? (e.size ?? null) : null })), truncated: !!r.json.truncated || rows.length > TREE_CAP };
}

// ── the renderers (one per read, both doors) ───────────────────────────────────────────────────
const day = (iso: string | null | undefined): string => (iso ?? '').slice(0, 10);
export function renderChanges(c: Changes): string {
  const rel = (c.releases as ScanRelease[]).slice(0, 8).map((r) => `- ${r.tag}${r.name && r.name !== r.tag ? ` · ${r.name}` : ''} · ${day(r.publishedAt)}${r.prerelease ? ' · prerelease' : ''}${r.body ? `\n  ${r.body.replace(/\s+/g, ' ').slice(0, 400)}` : ''}${r.url ? `\n  ${r.url}` : ''}`);
  const prs = (c.prs as ScanPr[]).slice(0, 40).map((p) => `- #${p.number} ${p.title} · ${p.author ?? 'unknown'} · merged ${day(p.mergedAt)}${p.labels?.length ? ` · ${p.labels.join(', ')}` : ''}${p.url ? ` · ${p.url}` : ''}`);
  const tags = (c.tags as ScanTag[]).slice(0, 8).map((t) => `- ${t.name} · ${day(t.date)}`);
  const commits = c.commits.slice(0, 30).map((x) => `- ${x.sha.slice(0, 7)} ${x.message} · ${x.author ?? 'unknown'} · ${day(x.date)}`);
  return [
    `${c.slug}${c.repo ? ` · default branch ${c.repo.defaultBranch}${c.repo.private ? ' · private' : ''}` : ''} · changes since ${day(c.since)}`,
    `Releases (newest first):${rel.length ? `\n${rel.join('\n')}` : ' none published'}`,
    `Merged pull requests since ${day(c.since)}:${prs.length ? `\n${prs.join('\n')}` : ' none'}`,
    ...(tags.length ? [`Tags (no releases published):\n${tags.join('\n')}`] : []),
    `Commits on the default branch since ${day(c.since)}:${commits.length ? `\n${commits.join('\n')}` : ' none'}`,
    'A CHANGELOG.md, when the repository keeps one, is one read_repo_file away. Never invent a release, a number or a name that is not above.',
  ].join('\n\n');
}
export const renderFile = (f: FileOut): string => `${f.slug} · ${f.path}${f.ref ? ` @ ${f.ref}` : ''} · ${f.size} bytes${f.truncated ? ` · cut at ${FILE_TEXT_CAP} characters` : ''}\n\n${f.content}`;
export function renderTree(t: TreeOut): string {
  const lines = t.entries.map((e) => (e.type === 'tree' ? `${e.path}/` : `${e.path}${e.size != null ? ` (${e.size} B)` : ''}`));
  return `${t.slug} · ${t.path || '(root)'} @ ${t.ref} · ${t.entries.length} entries${t.truncated ? ' (cut: name a deeper path)' : ''}\n${lines.join('\n')}`;
}

/** the reader for one room: the connector first, the machine's gh second, the honest refusal third */
export function makeRepoReader(deps: { apiGet: ApiGetFn; actor: ActorRef; db: ReplicaDb; channelId: string; capable?: () => Promise<boolean> }): RepoReader {
  const { apiGet, actor, db, channelId } = deps;
  const capable = deps.capable ?? ghCapable;
  // which door, decided per call: the row can flip between two reads (a human just connected)
  const door = async (): Promise<{ kind: 'api' } | { kind: 'gh'; slug: string } | { kind: 'none'; text: string }> => {
    if (await githubConnected(db, channelId)) return { kind: 'api' };
    const repo = await primaryRepoRow(db, channelId);
    if (!repo) return { kind: 'none', text: NO_REPO };
    const slug = await repoSlugFor(repo);
    if (!slug || slug.startsWith('local/')) return { kind: 'none', text: `${repo.name} has no GitHub remote to read. Say so plainly.` };
    if (await capable()) return { kind: 'gh', slug };
    return { kind: 'none', text: NOT_CONNECTED };
  };
  const refusal = (r: { code: string; error: string }): string => (r.code === 'RECONNECT_REQUIRED' ? RECONNECT : r.code === 'NO_REPO' ? NO_REPO : r.code === 'NOT_CONNECTED' ? NOT_CONNECTED : `The repository read failed: ${r.error}. Report it; never fill the gap with guesses.`);
  return {
    async changes(i) {
      const since = i.since && !Number.isNaN(Date.parse(i.since)) ? new Date(i.since).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString();
      const d = await door();
      if (d.kind === 'none') return d.text;
      if (d.kind === 'gh') return renderChanges(await ghChanges(d.slug, since));
      const r = await viaApi<Changes>(apiGet, actor, 'changes', { channel: channelId, since });
      return r.ok ? renderChanges(r.body) : refusal(r);
    },
    async file(i) {
      const d = await door();
      if (d.kind === 'none') return d.text;
      if (d.kind === 'gh') { const f = await ghFile(d.slug, i.path, i.ref); return typeof f === 'string' ? f : renderFile(f); }
      const r = await viaApi<FileOut>(apiGet, actor, 'file', { channel: channelId, path: i.path, ref: i.ref });
      return r.ok ? renderFile(r.body) : r.status === 400 ? r.error : refusal(r);
    },
    async tree(i) {
      const d = await door();
      if (d.kind === 'none') return d.text;
      if (d.kind === 'gh') { const t = await ghTree(d.slug, i.path, i.ref); return typeof t === 'string' ? t : renderTree(t); }
      const r = await viaApi<TreeOut>(apiGet, actor, 'tree', { channel: channelId, path: i.path, ref: i.ref });
      return r.ok ? renderTree(r.body) : r.status === 400 ? r.error : refusal(r);
    },
  };
}
