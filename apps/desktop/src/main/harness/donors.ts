// Dependency donors (worktree-berths round, docs/design/worktree-berths-2026-08 §3.2).
//
// A worktree's dependencies are a pure function of its lockfiles, and every attempt of every task
// was paying that function's full price again — a multi-GB, minutes-long cold install per worktree
// (the direct attacker of the <10% agent-overhead budget, and the whole "20 GB of repeated
// node_modules" trend). So: after a successful run, STASH the installed trees once per
// (repo, lockfile-hash) as a DONOR; every later worktree with the same hash HYDRATES from it by
// copy-on-write clone — O(1) in tree size, ~zero marginal disk, blocks diverge lazily.
//
// Safety rails, in order of importance:
//  · keyed by lockfile hash — a donor never crosses a dependency change (the sqlite-ABI lesson);
//  · CoW or nothing — darwin `cp -c` (clonefile), linux `cp --reflink=always`; when the filesystem
//    can't CoW we SKIP, never fall back to a real multi-GB copy that would eat the win;
//  · the repo's own gitignore must claim the trees — a repo that doesn't ignore node_modules would
//    otherwise see `git add -A` commit it at submit; hydration undoes itself and stands down;
//  · a donor is complete iff its manifest exists INSIDE it, and it lands by atomic rename —
//    a crash mid-stash leaves a `.building-*` dir the next stash sweeps away.
//
// Electron-free like the rest of harness/ (testable under `tsx --test`); spawned git rides
// gitChildEnv so a leaked hook GIT_DIR can never redirect it (see workspaces.ts).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gitChildEnv } from './workspaces';

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock'] as const;
const DEP_DIR = 'node_modules';
const MAX_DEP_DIRS = 12; // monorepo packages beyond this hydrate cold — logged, never silent
const KEEP_HASHES = 2;   // per repo: the live lockfile + one back (a revert doesn't re-install)

export type DonorManifest = {
  lockHash: string;
  relPaths: string[];
  apparentBytes: number;
  createdAt: string;
  platform: string;
  arch: string;
};

export type DonorNote =
  | { action: 'stashed'; ms: number; relPaths: string[]; apparentBytes: number }
  | { action: 'hydrated'; ms: number; relPaths: string[] }
  | { action: 'exists' }
  | { action: 'skipped'; reason: 'no-lockfile' | 'no-deps' | 'no-donor' | 'no-cow' | 'not-ignored' };

/** SHA-256 over the sorted (name, content) pairs of the lockfiles present; null when none. */
export function lockHash(dir: string): string | null {
  const present = LOCKFILES.filter((f) => existsSync(join(dir, f)));
  if (!present.length) return null;
  const h = createHash('sha256');
  for (const f of present) {
    h.update(f);
    h.update('\0');
    h.update(readFileSync(join(dir, f)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Relative paths of dependency dirs to stash: the root node_modules plus nested package ones
 * (pnpm workspaces), found by a shallow walk. Never descends INTO a node_modules (its own nesting
 * belongs to the clone), never into dot-dirs (.git, .next), depth-capped so a pathological tree
 * can't turn discovery into the cost it exists to avoid.
 */
export function findDependencyDirs(root: string, maxDepth = 3): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (out.length >= MAX_DEP_DIRS) return;
    const abs = rel ? join(root, rel) : root;
    let entries: string[];
    try {
      entries = readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return;
    }
    if (entries.includes(DEP_DIR)) out.push(rel ? `${rel}/${DEP_DIR}` : DEP_DIR);
    if (depth >= maxDepth) return;
    for (const name of entries) {
      if (name === DEP_DIR || name.startsWith('.')) continue;
      walk(rel ? `${rel}/${name}` : name, depth + 1);
    }
  };
  walk('', 0);
  return out.slice(0, MAX_DEP_DIRS);
}

/**
 * CoW-clone src as dst (dst must not exist). Throws when the filesystem can't CoW — caller skips.
 *
 * darwin fast path: ONE kernel-side clonefile(2) of the whole directory — measured 1.7s vs 20.4s
 * for `cp -Rc` on this repo's 3.0GB / ~130k-file node_modules, because cp re-walks the tree in
 * userland while the kernel clones the subtree in a single call. Reached via the system python3's
 * ctypes (present wherever the CLT that git itself needs is installed) so we ship no native addon;
 * any failure — no python3, ENOTSUP, cross-volume — falls back to `cp -Rc`, then the caller's
 * honest skip. Linux: `--reflink=always` (btrfs/XFS), which FAILS rather than degrade to a real
 * copy — that failure is the skip signal, by design.
 */
async function cloneTree(src: string, dst: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  mkdirSync(join(dst, '..'), { recursive: true });
  if (process.platform === 'darwin') {
    try {
      const py = 'import ctypes,sys; libc=ctypes.CDLL("/usr/lib/libSystem.dylib",use_errno=True); sys.exit(0 if libc.clonefile(sys.argv[1].encode(),sys.argv[2].encode(),0)==0 else 1)';
      await run('/usr/bin/python3', ['-c', py, src, dst], { env: gitChildEnv() });
      return;
    } catch { /* fall through to cp -Rc */ }
    await run('cp', ['-Rc', src, dst], { env: gitChildEnv() });
    return;
  }
  await run('cp', ['-R', '--reflink=always', src, dst], { env: gitChildEnv() });
}

/** Apparent bytes of a tree (block-shared with its clones — apparent > real by design; see plan §3.3). */
export function treeBytes(dir: string): number {
  let total = 0;
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      else if (e.isDirectory()) walk(p);
      else {
        try { total += statSync(p).size; } catch { /* raced away */ }
      }
    }
  };
  walk(dir);
  return total;
}

const manifestPath = (donorDir: string): string => join(donorDir, 'manifest.json');

export function readManifest(donorDir: string): DonorManifest | null {
  try {
    return JSON.parse(readFileSync(manifestPath(donorDir), 'utf8')) as DonorManifest;
  } catch {
    return null;
  }
}

/**
 * Stash the worktree's dependency trees as the donor for their lockfile hash.
 * `donorsRepoDir` = cache/donors/<repoId>. Caller serializes per repo (withRepoLock).
 */
export async function stashDonor(worktreeDir: string, donorsRepoDir: string): Promise<DonorNote> {
  const hash = lockHash(worktreeDir);
  if (!hash) return { action: 'skipped', reason: 'no-lockfile' };
  const donorDir = join(donorsRepoDir, hash);
  if (readManifest(donorDir)) return { action: 'exists' };
  const relPaths = findDependencyDirs(worktreeDir);
  if (!relPaths.length) return { action: 'skipped', reason: 'no-deps' };

  const t0 = Date.now();
  // sweep crashed builds, then build beside the target and land by atomic rename
  for (const stale of existsSync(donorsRepoDir) ? readdirSync(donorsRepoDir).filter((n) => n.startsWith('.building-')) : []) {
    rmSync(join(donorsRepoDir, stale), { recursive: true, force: true });
  }
  const building = join(donorsRepoDir, `.building-${process.pid}`);
  rmSync(building, { recursive: true, force: true });
  try {
    for (const rel of relPaths) {
      await cloneTree(join(worktreeDir, rel), join(building, rel));
    }
  } catch {
    rmSync(building, { recursive: true, force: true });
    return { action: 'skipped', reason: 'no-cow' };
  }
  const apparentBytes = relPaths.reduce((n, rel) => n + treeBytes(join(worktreeDir, rel)), 0);
  const manifest: DonorManifest = {
    lockHash: hash, relPaths, apparentBytes,
    createdAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  };
  writeFileSync(manifestPath(building), JSON.stringify(manifest, null, 2));
  try {
    renameSync(building, donorDir);
  } catch {
    rmSync(building, { recursive: true, force: true }); // lost the race — the winner's donor stands
    return { action: 'exists' };
  }
  pruneDonors(donorsRepoDir);
  return { action: 'stashed', ms: Date.now() - t0, relPaths, apparentBytes };
}

/** Keep the newest KEEP_HASHES complete donors; everything else (and junk) goes. */
export function pruneDonors(donorsRepoDir: string, keep = KEEP_HASHES): string[] {
  if (!existsSync(donorsRepoDir)) return [];
  const entries = readdirSync(donorsRepoDir)
    .map((name) => ({ name, manifest: readManifest(join(donorsRepoDir, name)) }))
    .filter((e) => !e.name.startsWith('.building-')); // in-flight builds are the stasher's to sweep
  const complete = entries.filter((e) => e.manifest).sort((a, b) => (b.manifest!.createdAt).localeCompare(a.manifest!.createdAt));
  const dead = [...complete.slice(keep), ...entries.filter((e) => !e.manifest)];
  for (const e of dead) rmSync(join(donorsRepoDir, e.name), { recursive: true, force: true });
  return dead.map((e) => e.name);
}

/**
 * Hydrate a fresh worktree from its lockfile-matched donor. Refuses (and undoes itself) when the
 * repo does not gitignore the trees — hydration must never turn into a commit.
 */
export async function hydrateFromDonor(worktreeDir: string, donorsRepoDir: string): Promise<DonorNote> {
  const hash = lockHash(worktreeDir);
  if (!hash) return { action: 'skipped', reason: 'no-lockfile' };
  const donorDir = join(donorsRepoDir, hash);
  const manifest = readManifest(donorDir);
  if (!manifest) return { action: 'skipped', reason: 'no-donor' };

  const t0 = Date.now();
  const hydrated: string[] = [];
  for (const rel of manifest.relPaths) {
    const dst = join(worktreeDir, rel);
    if (existsSync(dst)) continue; // an already-present tree wins — never overwrite
    try {
      await cloneTree(join(donorDir, rel), dst);
      hydrated.push(rel);
    } catch {
      for (const done of hydrated) rmSync(join(worktreeDir, done), { recursive: true, force: true });
      return { action: 'skipped', reason: 'no-cow' };
    }
  }
  if (!hydrated.length) return { action: 'skipped', reason: 'no-donor' };
  // the gitignore guard: every hydrated root must be ignored by the repo's own rules
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    for (const rel of hydrated) {
      await promisify(execFile)('git', ['check-ignore', '-q', rel], { cwd: worktreeDir, env: gitChildEnv() });
    }
  } catch {
    for (const rel of hydrated) rmSync(join(worktreeDir, rel), { recursive: true, force: true });
    return { action: 'skipped', reason: 'not-ignored' };
  }
  return { action: 'hydrated', ms: Date.now() - t0, relPaths: hydrated };
}
