// The reads the GitHub connector serves to the agents' tools (docs/design/github-connector-2026-09
// §3.3): one file, one tree, the commits since a date, and the installation's own facts. Pure
// GitHub I/O over the github-app.ts request layer: a token in, rows out, every cap stated here
// so the routes and the tests agree on what "too big" means. Nothing here writes.
import { appJwt, GitHubApiError, githubGet, type AppOpts, type GitHubOpts } from './github-app';

/** a file's text above this is cut, and the answer says so (an agent reads a chapter, not a book) */
export const FILE_TEXT_CAP = 60_000;
/** GitHub's contents API carries base64 up to 1 MB; past it the answer is a pointer, not a file */
export const FILE_SIZE_CAP = 1_000_000;
/** the tree answer's cap: a monorepo's full tree is tens of thousands of rows */
export const TREE_CAP = 500;

export interface RepoFile { path: string; ref: string | null; size: number; sha: string; content: string; truncated: boolean }
export interface TreeEntry { path: string; type: 'blob' | 'tree'; size: number | null }
export interface RepoTree { ref: string; path: string; entries: TreeEntry[]; truncated: boolean }
export interface RepoCommit { sha: string; message: string; date: string | null; author: string | null; url: string }
export interface InstallationFacts { account: string; selection: 'all' | 'selected' }

/** a path as GitHub wants it: no leading slash, no `..`, no trailing slash */
export function cleanPath(p: string | null | undefined): string {
  const parts = String(p ?? '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new GitHubApiError('a path cannot climb out of the repository', 400);
  return parts.join('/');
}

const looksBinary = (buf: Buffer): boolean => buf.subarray(0, 8000).includes(0);

/** one file as text. A directory, a binary, or a file past the size cap answers with its own status. */
export async function readRepoFile(slug: string, path: string, ref: string | null, opts: GitHubOpts): Promise<RepoFile> {
  const p = cleanPath(path);
  if (!p) throw new GitHubApiError('name a file path', 400);
  const r = await githubGet(`/repos/${slug}/contents/${p.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, opts);
  if (r.status === 404) throw new GitHubApiError(`no file at ${p}${ref ? ` on ${ref}` : ''}`, 404);
  if (r.status < 200 || r.status >= 300) throw new GitHubApiError(`GitHub answered ${r.status} for ${p}`, r.status);
  if (Array.isArray(r.json)) throw new GitHubApiError(`${p} is a directory: list it with the tree read`, 400);
  const b = r.json as { type?: string; size?: number; sha?: string; content?: string; encoding?: string };
  if (b.type !== 'file') throw new GitHubApiError(`${p} is a ${b.type ?? 'link'}, not a file`, 400);
  const size = b.size ?? 0;
  if (size > FILE_SIZE_CAP || b.encoding !== 'base64' || typeof b.content !== 'string') throw new GitHubApiError(`${p} is larger than 1 MB: read a smaller file`, 413);
  const buf = Buffer.from(b.content.replace(/\n/g, ''), 'base64');
  if (looksBinary(buf)) throw new GitHubApiError(`${p} is a binary file`, 415);
  const text = buf.toString('utf8');
  return { path: p, ref, size, sha: b.sha ?? '', content: text.length > FILE_TEXT_CAP ? text.slice(0, FILE_TEXT_CAP) : text, truncated: text.length > FILE_TEXT_CAP };
}

/** an app screenshot may weigh this much in the repository; the shelf copy is shrunk to fit (shelf-image.ts) */
export const IMAGE_SIZE_CAP = 8_000_000;
export interface RepoImage { path: string; sha: string; size: number; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array }
/** the format by the file's own first bytes, never by its name: a renamed text file is not an image */
export function sniffShot(b: Uint8Array): RepoImage['mime'] | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** one image file of the repository, as bytes (George, 2026-10-06: an app screenshot from the code).
 *  Up to 1 MB the contents API carries it; past that, the Git blob by its sha (to IMAGE_SIZE_CAP). */
export async function readRepoImage(slug: string, path: string, opts: GitHubOpts): Promise<RepoImage> {
  const p = cleanPath(path);
  if (!p) throw new GitHubApiError('name an image file path', 400);
  const r = await githubGet(`/repos/${slug}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, opts);
  if (r.status === 404) throw new GitHubApiError(`no file at ${p}`, 404);
  if (r.status < 200 || r.status >= 300) throw new GitHubApiError(`GitHub answered ${r.status} for ${p}`, r.status);
  if (Array.isArray(r.json)) throw new GitHubApiError(`${p} is a directory: list it with the tree read`, 400);
  const b = r.json as { type?: string; size?: number; sha?: string; content?: string; encoding?: string };
  if (b.type !== 'file' || !b.sha) throw new GitHubApiError(`${p} is a ${b.type ?? 'link'}, not a file`, 400);
  const size = b.size ?? 0;
  if (size > IMAGE_SIZE_CAP) throw new GitHubApiError(`${p} is larger than ${IMAGE_SIZE_CAP / 1e6} MB: pick a smaller screenshot`, 413);
  let base64 = b.encoding === 'base64' && b.content ? b.content : null;
  if (!base64) {
    const blob = await githubGet(`/repos/${slug}/git/blobs/${b.sha}`, opts);
    const bb = blob.json as { content?: string; encoding?: string } | null;
    if (blob.status < 200 || blob.status >= 300 || bb?.encoding !== 'base64' || !bb.content) throw new GitHubApiError(`GitHub answered ${blob.status} for the blob of ${p}`, blob.status >= 400 ? blob.status : 502);
    base64 = bb.content;
  }
  const bytes = new Uint8Array(Buffer.from(base64.replace(/\n/g, ''), 'base64'));
  const mime = sniffShot(bytes);
  if (!mime) throw new GitHubApiError(`${p} is not a PNG, JPEG or WebP image`, 415);
  return { path: p, sha: b.sha, size: bytes.length, mime, bytes };
}

/** the tree under `path` (the whole repository when empty), one recursive read, capped */
export async function readRepoTree(slug: string, path: string | null, ref: string | null, opts: GitHubOpts): Promise<RepoTree> {
  const p = cleanPath(path);
  const at = ref || 'HEAD';
  const r = await githubGet(`/repos/${slug}/git/trees/${encodeURIComponent(at)}?recursive=1`, opts);
  if (r.status === 404) throw new GitHubApiError(`no tree at ${at}`, 404);
  if (r.status < 200 || r.status >= 300) throw new GitHubApiError(`GitHub answered ${r.status} for the tree`, r.status);
  const b = r.json as { tree?: Array<{ path: string; type: string; size?: number }>; truncated?: boolean };
  const prefix = p ? `${p}/` : '';
  const rows = (b.tree ?? []).filter((e) => (e.type === 'blob' || e.type === 'tree') && (!prefix || e.path.startsWith(prefix)));
  if (p && !rows.length) throw new GitHubApiError(`no directory at ${p}`, 404);
  const entries: TreeEntry[] = rows.slice(0, TREE_CAP).map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.type === 'blob' ? (e.size ?? null) : null }));
  return { ref: at, path: p, entries, truncated: !!b.truncated || rows.length > TREE_CAP };
}

/** the commits on `branch` since a date, newest first (one page of 50) */
export async function readRepoCommits(slug: string, since: string, branch: string | null, opts: GitHubOpts): Promise<RepoCommit[]> {
  const qs = new URLSearchParams({ since, per_page: '50' });
  if (branch) qs.set('sha', branch);
  const r = await githubGet(`/repos/${slug}/commits?${qs.toString()}`, opts);
  if (r.status < 200 || r.status >= 300 || !Array.isArray(r.json)) return [];
  return (r.json as Array<{ sha: string; html_url: string; commit?: { message?: string; author?: { date?: string; name?: string } }; author?: { login?: string } | null }>)
    .map((c) => ({ sha: c.sha, message: (c.commit?.message ?? '').split('\n')[0] ?? '', date: c.commit?.author?.date ?? null, author: c.author?.login ?? c.commit?.author?.name ?? null, url: c.html_url }));
}

/** the installation as GitHub describes it: the account it sits on, and whether it covers every repository */
export async function installationFacts(installationId: number, opts: AppOpts = {}): Promise<InstallationFacts> {
  const r = await githubGet(`/app/installations/${installationId}`, { ...opts, token: appJwt(opts.env, opts.now) });
  if (r.status < 200 || r.status >= 300) throw new GitHubApiError(`GitHub answered ${r.status} for installation ${installationId}`, r.status);
  const b = r.json as { account?: { login?: string; slug?: string } | null; repository_selection?: string };
  return { account: b.account?.login ?? b.account?.slug ?? '', selection: b.repository_selection === 'all' ? 'all' : 'selected' };
}
