import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { EngineeringRuntimeChange } from '../../engineering-protocol';
import { gitChildEnv } from '../harness/workspaces';

const run = promisify(execFile);

async function git(cwd: string, args: string[], allowDiff = false): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, env: gitChildEnv(), encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
    return stdout;
  } catch (error: unknown) {
    const value = error as { code?: number; stdout?: string };
    if (allowDiff && value.code === 1) return value.stdout ?? '';
    throw error;
  }
}

const MAX_CHANGE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ENGINEERING_CHANGE_FILES = 100;
export const MAX_ENGINEERING_CHANGE_EVENT_BYTES = 4 * 1024 * 1024;
const CHANGE_SUMMARY_RESERVE_BYTES = 1024;
const TOO_LARGE = '[file too large to preview]';
const AGGREGATE_OMITTED = '[preview omitted: aggregate change limit]';
const SNAPSHOT_READ_BUDGET_BYTES = MAX_ENGINEERING_CHANGE_EVENT_BYTES / 2;
const contained = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const openedPaths = async (handles: FileHandle[]): Promise<Map<number, string>> => {
  if (!handles.length) return new Map();
  if (process.platform === 'linux') return new Map(await Promise.all(handles.map(async (handle) =>
    [handle.fd, await realpath(`/proc/self/fd/${handle.fd}`)] as const)));
  if (process.platform === 'darwin') {
    const { stdout } = await run('/usr/sbin/lsof', ['-a', '-p', String(process.pid), '-d', handles.map((handle) => handle.fd).join(','), '-Ffn'], {
      encoding: 'utf8', maxBuffer: 256 * 1024,
    });
    const paths = new Map<number, string>();
    let fd: number | null = null;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('f')) fd = Number(line.slice(1));
      else if (line.startsWith('n') && fd !== null) paths.set(fd, line.slice(1));
    }
    return paths;
  }
  throw new Error('The opened file path cannot be verified on this platform.');
};

/** Validate the kernel path of the opened descriptor itself. This remains bound to the vnode even
 * when a writable parent is swapped before or after open, unlike a second lookup of `candidate`. */
const workspaceTexts = async (canonicalRoot: string, paths: string[]): Promise<Map<string, { safe: boolean; exists: boolean; value: string }>> => {
  const results = new Map<string, { safe: boolean; exists: boolean; value: string }>(); let remaining = SNAPSHOT_READ_BUDGET_BYTES;
  const opened: Array<{ path: string; handle: FileHandle }> = [];
  for (const path of paths) {
    const candidate = resolve(canonicalRoot, path);
    if (!contained(canonicalRoot, candidate)) { results.set(path, { safe: false, exists: false, value: '' }); continue; }
    try { opened.push({ path, handle: await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }); }
    catch (error) { results.set(path, (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { safe: true, exists: false, value: '' } : { safe: false, exists: false, value: '' }); }
  }
  try {
    const canonical = await openedPaths(opened.map(({ handle }) => handle));
    for (const { path, handle } of opened) {
      const current = await handle.stat();
      const actual = canonical.get(handle.fd);
      if (!actual || !current.isFile() || !contained(canonicalRoot, actual)) { results.set(path, { safe: false, exists: false, value: '' }); continue; }
      if (current.size > MAX_CHANGE_FILE_BYTES) { results.set(path, { safe: true, exists: true, value: TOO_LARGE }); continue; }
      if (current.size > remaining) { results.set(path, { safe: true, exists: true, value: AGGREGATE_OMITTED }); continue; }
      const value = Buffer.allocUnsafe(current.size); const { bytesRead } = await handle.read(value, 0, current.size, 0); remaining -= bytesRead;
      const bounded = value.subarray(0, bytesRead);
      results.set(path, { safe: true, exists: true, value: bounded.includes(0) ? '[binary file]' : bounded.toString('utf8') });
    }
  } finally {
    await Promise.all(opened.map(({ handle }) => handle.close()));
  }
  return results;
};

const headText = async (cwd: string, path: string, budget: { remaining: number }): Promise<string> => {
  const size = Number(await git(cwd, ['cat-file', '-s', `HEAD:${path}`]));
  if (Number.isFinite(size) && size > MAX_CHANGE_FILE_BYTES) return TOO_LARGE;
  if (!Number.isFinite(size) || size > budget.remaining) return AGGREGATE_OMITTED;
  budget.remaining -= size;
  const value = await git(cwd, ['show', `HEAD:${path}`]);
  return value.includes('\0') ? '[binary file]' : value;
};
const cappedDiff = (value: string): string => value.length <= MAX_CHANGE_FILE_BYTES ? value : `${value.slice(0, MAX_CHANGE_FILE_BYTES)}\n[diff truncated]`;
const lineCount = (value: string): number => {
  if (!value) return 0;
  let count = 1;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
};
const snapshotDiff = (path: string, before: string, after: string, headExists: boolean, currentExists: boolean): string => {
  const oldText = before.replace(/\n$/, ''); const newText = after.replace(/\n$/, '');
  const oldLines = lineCount(oldText); const newLines = lineCount(newText);
  const header = `diff --git a/${path} b/${path}\n--- ${headExists ? `a/${path}` : '/dev/null'}\n+++ ${currentExists ? `b/${path}` : '/dev/null'}\n`;
  return cappedDiff(`${header}@@ -1,${oldLines} +1,${newLines} @@\n${oldText ? `-${oldText.replace(/\n/g, '\n-')}\n` : ''}${newText ? `+${newText.replace(/\n/g, '\n+')}\n` : ''}`);
};
const aggregatePlaceholder = (change: EngineeringRuntimeChange): EngineeringRuntimeChange => ({
  ...change,
  before: change.before ? '[preview omitted: aggregate change limit]' : '',
  after: change.after ? '[preview omitted: aggregate change limit]' : '',
  diff: '[diff omitted: aggregate change limit]',
});
const omittedPlaceholder = (count: number): EngineeringRuntimeChange => ({
  path: `[${count} additional changes omitted]`, kind: 'modified', before: '', after: '',
  diff: 'Open the repository to inspect the remaining changes.',
});

export async function collectEngineeringChanges(cwd: string): Promise<EngineeringRuntimeChange[]> {
  const canonicalRoot = await realpath(cwd);
  const [trackedRaw, untrackedRaw] = await Promise.all([
    git(cwd, ['diff', '--name-only', '-z', 'HEAD', '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const tracked = trackedRaw.split('\0').filter(Boolean);
  const untracked = untrackedRaw.split('\0').filter(Boolean);
  const candidates = [
    ...tracked.map((path) => ({ path, tracked: true })),
    ...untracked.map((path) => ({ path, tracked: false })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const inspected = candidates.slice(0, MAX_ENGINEERING_CHANGE_FILES - 1);
  const currentByPath = await workspaceTexts(canonicalRoot, inspected.map(({ path }) => path));
  const changes: EngineeringRuntimeChange[] = [];
  let totalBytes = 0; const headBudget = { remaining: SNAPSHOT_READ_BUDGET_BYTES };
  let omitted = candidates.length - inspected.length;
  for (let index = 0; index < inspected.length; index += 1) {
    const { path, tracked: isTracked } = inspected[index]!;
    const current = currentByPath.get(path) ?? { safe: false, exists: false, value: '' };
    if (!current.safe) continue;
    if (current.value === AGGREGATE_OMITTED) { omitted = candidates.length - index; break; }
    const headExists = isTracked && await git(cwd, ['cat-file', '-e', `HEAD:${path}`]).then(() => true).catch(() => false);
    const before = headExists ? await headText(cwd, path, headBudget) : '';
    if (before === AGGREGATE_OMITTED) { omitted = candidates.length - index; break; }
    const after = current.value;
    const diff = before === TOO_LARGE || after === TOO_LARGE
      ? '[diff omitted: file too large to preview]'
      : snapshotDiff(path, before, after, headExists, current.exists);
    const complete = { path, kind: !current.exists ? 'deleted' as const : headExists ? 'modified' as const : 'added' as const, before, after, diff };
    const completeBytes = Buffer.byteLength(JSON.stringify(complete));
    const budget = MAX_ENGINEERING_CHANGE_EVENT_BYTES - CHANGE_SUMMARY_RESERVE_BYTES;
    const change = totalBytes + completeBytes <= budget ? complete : aggregatePlaceholder(complete);
    const changeBytes = Buffer.byteLength(JSON.stringify(change));
    if (totalBytes + changeBytes > budget) { omitted = candidates.length - index; break; }
    totalBytes += changeBytes;
    changes.push(change);
  }
  if (omitted) changes.push(omittedPlaceholder(omitted));
  return changes;
}

/** Coalesces repeated mutation notifications while a git scan is in flight. */
export function createEngineeringChangeRefresh(
  cwd: string,
  emit: (changes: EngineeringRuntimeChange[]) => void,
  failed: (error: unknown) => void,
  collect: typeof collectEngineeringChanges = collectEngineeringChanges,
): () => void {
  let running = false;
  let queued = false;
  return () => {
    if (running) { queued = true; return; }
    running = true;
    void (async () => {
      do {
        queued = false;
        try { emit(await collect(cwd)); } catch (error: unknown) { failed(error); }
      } while (queued);
      running = false;
    })();
  };
}
