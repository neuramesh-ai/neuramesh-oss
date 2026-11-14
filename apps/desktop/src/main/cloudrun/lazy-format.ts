import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface LazySegment { path: string; key: string; hash: string; dependencies: string[]; gitMarker?: string; gitMode?: number; gitUid?: number; gitGid?: number }
export interface LazyManifest { format: 'nm-lazy-work'; version: 1; epoch: number; work: string; core: string; coreHash: string; segments: LazySegment[] }
export const manifestKey = (key: string): boolean => /^manifest-e\d+$/.test(key);
const keyOk = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key);
export function safeRelative(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0')
    && path.split('/').every(p => p.length > 0 && p !== '.' && p !== '..');
}
export function parseManifest(input: unknown, work: string): LazyManifest {
  const m = input as Partial<LazyManifest> | null;
  if (!m || m.format !== 'nm-lazy-work' || m.version !== 1 || !Number.isSafeInteger(m.epoch) || m.epoch! < 1
    || m.work !== work || m.core !== `core-e${m.epoch}` || !/^[a-f0-9]{64}$/.test(m.coreHash ?? '') || !Array.isArray(m.segments) || m.segments.length > 10_000) throw Error('Invalid saved workspace manifest.');
  const paths = new Set<string>();
  for (const s of m.segments) {
    if (!s || !safeRelative(s.path) || !s.path.startsWith(work + '/') || paths.has(s.path) || !keyOk(s.key)
      || !/^[a-f0-9]{64}$/.test(s.hash) || s.key !== chunkKey(s.path, s.hash) || !Array.isArray(s.dependencies)
      || s.dependencies.some(p => !safeRelative(p)) || (s.gitMarker !== undefined && (typeof s.gitMarker !== 'string' || s.gitMarker.length > 4096 || !/^gitdir: /m.test(s.gitMarker)))
      || [s.gitMode, s.gitUid, s.gitGid].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0)) || (s.gitMode ?? 0) > 0o7777) throw Error('Invalid saved workspace segment.');
    paths.add(s.path);
  }
  for (const s of m.segments) {
    if (s.dependencies.some(p => !paths.has(p)) || [...paths].some(p => p !== s.path && s.path.startsWith(p + '/'))) throw Error('Invalid workspace dependency or overlapping segment.');
  }
  const done = new Set<string>(), visiting = new Set<string>();
  const visit = (path: string) => {
    if (visiting.has(path)) throw Error('Invalid cyclic workspace dependency.');
    if (done.has(path)) return;
    visiting.add(path);
    for (const dep of m.segments!.find(s => s.path === path)!.dependencies) visit(dep);
    visiting.delete(path); done.add(path);
  };
  for (const path of paths) visit(path);
  return m as LazyManifest;
}
export function chunkKey(path: string, hash: string): string { return `chunk-${createHash('sha256').update(path + '\0' + hash).digest('hex')}`; }

/** Stable across tar round trips: seconds, numeric ownership, permissions and hard-link topology. */
export async function fingerprint(path: string): Promise<string> {
  const h = createHash('sha256'), links = new Map<string, string>();
  async function walk(file: string, name: string): Promise<void> {
    const s = lstatSync(file);
    h.update(JSON.stringify([name, s.mode, s.uid, s.gid, Math.floor(s.mtimeMs / 1000)]));
    if (s.isSymbolicLink()) h.update(readlinkSync(file));
    else if (s.isDirectory()) for (const n of readdirSync(file).sort()) await walk(join(file, n), name + '/' + n);
    else if (s.isFile()) {
      const inode = `${s.dev}:${s.ino}`, first = links.get(inode);
      if (first !== undefined) h.update(`hardlink:${first}`);
      else { links.set(inode, name); for await (const bytes of createReadStream(file)) h.update(bytes); }
    }
  }
  await walk(path, ''); return h.digest('hex');
}

/** Cold boundaries have explicit hydration doors. Notes, journals, outboxes and replicas stay core. */
export function coldPaths(root: string, work: string, brain = join(work, 'brain')): string[] {
  const result: string[] = [];
  const children = (base: string, suffix = '') => {
    const full = join(root, base);
    if (!existsSync(full) || !lstatSync(full).isDirectory()) return;
    for (const name of readdirSync(full).sort()) {
      const path = join(base, name, suffix), f = join(root, path);
      if (existsSync(f) && lstatSync(f).isDirectory() && safeRelative(path)) result.push(path);
    }
  };
  children(join(brain, 'subjects'), 'workspace');
  for (const kind of ['repos', 'worktrees', 'donors']) children(join(brain, 'cache', kind));
  children(join(brain, 'deliverables'));
  // Cross-boundary hard links stay together in core; splitting must not change their semantics.
  const inodes = new Map<string, string | null>(), keep = new Set<string>();
  const owner = (p: string) => result.find(s => p === s || p.startsWith(s + sep)) ?? null;
  function walk(path: string): void {
    const s = lstatSync(join(root, path));
    if (s.isDirectory()) for (const n of readdirSync(join(root, path))) walk(join(path, n));
    else if (s.isFile() && s.nlink > 1) {
      const inode = `${s.dev}:${s.ino}`, now = owner(path);
      if (inodes.has(inode) && inodes.get(inode) !== now) { const old = inodes.get(inode); if (old) keep.add(old); if (now) keep.add(now); }
      else inodes.set(inode, now);
    }
  }
  if (existsSync(join(root, work))) walk(work);
  return result.filter(p => !keep.has(p));
}

export function segmentDependencies(root: string, paths: string[]): Map<string, Pick<LazySegment, 'dependencies' | 'gitMarker' | 'gitMode' | 'gitUid' | 'gitGid'>> {
  const out = new Map<string, Pick<LazySegment, 'dependencies' | 'gitMarker' | 'gitMode' | 'gitUid' | 'gitGid'>>();
  for (const path of paths) {
    const marker = join(root, path, '.git'); let gitMarker: string | undefined;
    const deps = new Set<string>();
    const add = (target: string) => { const p = relative(root, target); const found = paths.find(s => s !== path && (p === s || p.startsWith(s + sep))); if (found) deps.add(found); };
    if (existsSync(marker) && lstatSync(marker).isFile() && lstatSync(marker).size <= 4096) {
      const text = readFileSync(marker, 'utf8'), match = /^gitdir:\s*(.+)$/m.exec(text);
      if (match) { gitMarker = text; add(resolve(dirname(marker), match[1]!.trim())); }
    }
    const stat = gitMarker ? lstatSync(marker) : null;
    out.set(path, { dependencies: [...deps], ...(stat ? { gitMarker, gitMode: stat.mode & 0o7777, gitUid: stat.uid, gitGid: stat.gid } : {}) });
  }
  return out;
}
