// The code-workspace file + git surface, and the pickers that feed project setup —
// extracted from sync.ts (track B-sync).
//
// scopedPath is the containment rule for every read and write here: a path that resolves
// outside its declared root is refused rather than clamped, so a `../` in a relative path
// cannot walk out of the workspace the human opened.
import { ipcMain, dialog } from 'electron';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { detectProjectMeta, parseOriginRemote } from '../../projectdetect';
import { detectFolderLogo, detectSiteLogo } from '../../logodetect';
import { api, ws } from '../../sync';

export function registerWorkspaceFiles(): void {
ipcMain.handle('nm:pick-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose a project folder' });
  const path = res.canceled ? null : res.filePaths[0] ?? null;
  if (!path) return null;
  let isGit = false;
  let branch = 'main';
  const head = await readFile(join(path, '.git', 'HEAD'), 'utf8').catch(() => '');
  if (head) { isGit = true; const m = /ref:\s*refs\/heads\/(.+)/.exec(head.trim()); if (m?.[1]) branch = m[1].trim(); }
  const gitConfig = isGit ? await readFile(join(path, '.git', 'config'), 'utf8').catch(() => '') : '';
  const remoteLabel = gitConfig ? parseOriginRemote(gitConfig)?.label ?? null : null;
  return { path, name: basename(path), isGit, branch, remoteLabel };
});

// folder → suggested project metadata for the New project modal (name/slug/description/
// rooms/remote). A few local file reads in the picked folder; best-effort, never throws,
// nothing leaves the machine.
ipcMain.handle('nm:project-detect', async (_e, { path }: { path: string }) => {
  if (typeof path !== 'string' || !path || resolve(path) !== path) return null; // absolute paths only (from the picker)
  return detectProjectMeta(path);
});

// website / repo folder → detected project logo (a compact data: URL) for the New
// project modal + Project settings. Local compute: THIS machine fetches the site's
// icons or reads the folder — nothing routes through the server. Best-effort, never throws.
ipcMain.handle('nm:logo-detect', async (_e, { url, path }: { url?: string; path?: string }) => {
  if (typeof url === 'string' && url.trim()) return detectSiteLogo(url);
  if (typeof path === 'string' && path && resolve(path) === path) return detectFolderLogo(path); // absolute paths only (from the picker)
  return null;
});

// register a repo to the workspace — a github/gitlab URL or a local folder (humans
// post as themselves); the row syncs back so pickers + orchestrator see it at once.
ipcMain.handle('nm:repo-add', async (_e, { channelSlug, projectId, url, defaultBranch, localPath, name }: { channelSlug?: string; projectId?: string; url?: string; defaultBranch?: string; localPath?: string; name?: string }) =>
  api('/v1/commands', { type: 'repo.link', workspace: ws(), channel: channelSlug, project: projectId, url: url?.trim() || undefined, localPath, name, defaultBranch: defaultBranch?.trim() || 'main' }));

// Root-scoped filesystem reads for the code workspace. Every path is resolved and
// must stay inside the chosen root (a project repo's local folder or clone), so the
// renderer can never read outside the folder the user opened. Reads only — edits are
// a separate, explicit IPC.
const scopedPath = (root: string, rel: string): string | null => {
  const r = resolve(root);
  const full = resolve(r, (rel || '').replace(/^[/\\]+/, ''));
  return full === r || full.startsWith(r + sep) ? full : null;
};
ipcMain.handle('nm:fs-list', async (_e, { root, path: rel }: { root: string; path?: string }) => {
  const full = scopedPath(root, rel ?? '');
  if (!full) return { entries: [], error: 'outside root' };
  const ents = await readdir(full, { withFileTypes: true }).catch(() => null);
  if (!ents) return { entries: [], error: 'not a directory' };
  const entries = ents
    .filter((e) => e.name !== '.git') // git internals are huge and not useful to browse
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries };
});
ipcMain.handle('nm:fs-read', async (_e, { root, path: rel }: { root: string; path: string }) => {
  const full = scopedPath(root, rel);
  if (!full) return { content: '', error: 'outside root' };
  const st = await stat(full).catch(() => null);
  if (!st || st.isDirectory()) return { content: '', error: 'not a file' };
  const MAX = 512 * 1024; // cap; the viewer is for reading, not loading giant blobs
  const buf = await readFile(full).catch(() => null);
  if (!buf) return { content: '', error: 'unreadable' };
  if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) return { content: '', binary: true };
  return { content: buf.subarray(0, MAX).toString('utf8'), truncated: buf.length > MAX, binary: false };
});
ipcMain.handle('nm:fs-write', async (_e, { root, path: rel, content }: { root: string; path: string; content: string }) => {
  const full = scopedPath(root, rel);
  if (!full) return { ok: false, error: 'outside root' };
  const st = await stat(full).catch(() => null);
  if (st?.isDirectory()) return { ok: false, error: 'is a directory' };
  try {
    await writeFile(full, content, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message?.slice(0, 160) ?? 'write failed' };
  }
});

// git branch read/switch for the code workspace (cwd = the open root). Local only —
// uses the machine's own git, like the worktree runner.
const gitRun = async (root: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    const { stdout } = await run('git', args, { cwd: root, timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return { ok: true, out: stdout.trim(), err: '' };
  } catch (e) {
    const er = e as { stderr?: string; message?: string };
    return { ok: false, out: '', err: (er.stderr || er.message || 'git failed').toString().trim() };
  }
};
ipcMain.handle('nm:git-branches', async (_e, { root }: { root: string }) => {
  const head = await gitRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok) return { current: null, branches: [] }; // not a git dir
  const list = await gitRun(root, ['branch', '--format=%(refname:short)']);
  return { current: head.out, branches: list.out.split('\n').map((s) => s.trim()).filter(Boolean) };
});
ipcMain.handle('nm:git-checkout', async (_e, { root, branch }: { root: string; branch: string }) => {
  const r = await gitRun(root, ['checkout', branch]);
  return r.ok ? { ok: true } : { ok: false, error: r.err.split('\n').find(Boolean)?.slice(0, 180) ?? 'checkout failed' };
});
}
