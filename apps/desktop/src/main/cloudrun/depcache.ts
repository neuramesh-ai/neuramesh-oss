// THE DEPENDENCY CACHE ON CLOUD RUN (NM_DEPCACHE=1, architecture §4 and §10.4). On gVisor the donors
// cannot copy-on-write (harness/donors.ts skips with no-cow), so without this every new worktree of a
// Cloud Run machine starts with no node_modules. This puts the dependency trees in GCS, keyed by the
// lockfile hash plus platform, arch and Node major (snapshot.ts lockKeyOf), through the machine's sign
// route (kind 'depcache', workspace-wide, uploads fenced by epoch).
//
// WHERE AN INSTALL CAN RUN, and so where each half is called:
//  - restore (hydrate): when a worktree is cut, for the Code lane (relay/engineering-workspace.ts) and
//    the task lane (execution.ts). A Code session's shell has no network (socket() is denied), so it
//    can never run `pnpm install`: a restore is the only way its dependencies arrive.
//  - save (remember): after a task's successful submit (execution.ts). The task's agent runs in the box,
//    which has egress, so it can install.
//  - install on a miss (D17, depinstall.ts, NM_DEPCACHE_HOST_INSTALL): the supervisor installs the
//    lockfile with lifecycle scripts off, no secret in the env, inside Bubblewrap, under a timeout and
//    a memory budget. The box then runs the lifecycle scripts, and the cache stores the tree, so the
//    next session with that lockfile hits. The supervisor never runs a repository's own code: it holds
//    the epoch token and the boot credential.
//
// Rails, as the donors have them: a tree the repository does not gitignore is never restored (a
// `git add -A` at submit would commit it), and the first stored tree for a key wins (depSave skips a
// key that exists).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findDependencyDirs } from '../harness/donors';
import { gitChildEnv } from '../harness/workspaces';
import type { HostInstaller, InstallOutcome } from './depinstall';
import { LOCKFILES, type Snapshots } from './snapshot';

export type DepNote =
  | { action: 'hit' | 'saved' | 'exists'; key: string; ms: number; paths?: string[] }
  /** `fallback`: why the host install did not fill the worktree (the agent installs as before) */
  | { action: 'miss'; key: string; ms: number; fallback?: string }
  /** the host install filled the worktree. `stored`: what the cache did with the tree */
  | { action: 'installed'; key: string; ms: number; paths: string[]; stored: 'saving' | 'held' }
  | { action: 'skipped'; reason: 'no-lockfile' | 'has-deps' | 'no-deps' | 'not-ignored' };

/** the session hears these while the host installs (relay/engineering-host.ts sends them as `status`) */
export type DepPhase = 'installing_dependencies' | 'dependencies_ready';

export interface DepCache {
  /** restore the dependency trees of a fresh worktree; never overwrites a tree that is there. On a miss
   *  with a host installer, install them, and tell `phase` when that starts and ends */
  hydrate(worktreeDir: string, phase?: (p: DepPhase) => void): Promise<DepNote>;
  /** store the worktree's installed trees under its lockfile's key, once per key */
  remember(worktreeDir: string): Promise<DepNote>;
}

// THE SEAM, as useCodeShellLane is: machined installs it on a Cloud Run machine with NM_DEPCACHE=1,
// and every other machine (the desktop, GKE) leaves it null, so the callers do nothing.
let current: DepCache | null = null;
export function useDepCache(d: DepCache | null): void { current = d; }
export function depCache(): DepCache | null { return current; }

export const depCacheOn = (env: NodeJS.ProcessEnv = process.env): boolean => env['NM_DEPCACHE'] === '1';

const hasLockfile = (dir: string): boolean => LOCKFILES.some((f) => existsSync(join(dir, f)));

/** every tree the repository's own rules ignore. git reads the rules, so a nested .gitignore counts. */
async function allIgnored(dir: string, rels: string[]): Promise<boolean> {
  try {
    for (const rel of rels) await promisify(execFile)('git', ['check-ignore', '-q', rel], { cwd: dir, env: gitChildEnv() });
    return true;
  } catch {
    return false;
  }
}

/** remove the trees the install made (never one that was there before, which git may track), so a
 *  failed install leaves the worktree as a miss leaves it */
function removeNewTrees(dir: string, before: ReadonlySet<string>): void {
  for (const rel of new Set(['node_modules', ...findDependencyDirs(dir)])) if (!before.has(rel)) rmSync(join(dir, rel), { recursive: true, force: true });
}

const fallbackOf = (r: Extract<InstallOutcome, { ok: false }>): string => (r.detail ? `${r.reason} (${r.detail})` : r.reason);

export function snapshotDepCache(s: Pick<Snapshots, 'depRestore' | 'depSave'>, log: (line: string) => void = () => {}, opts: { install?: HostInstaller } = {}): DepCache {
  const cache: DepCache = {
    async hydrate(dir, phase) {
      if (!hasLockfile(dir)) return { action: 'skipped', reason: 'no-lockfile' };
      if (existsSync(join(dir, 'node_modules'))) return { action: 'skipped', reason: 'has-deps' };
      const t0 = Date.now();
      const r = await s.depRestore(dir);
      if (!r.hit) {
        log(`depcache miss ${r.key}`);
        if (!opts.install) return { action: 'miss', key: r.key, ms: Date.now() - t0 };
        return installOnMiss(dir, r.key, t0, phase);
      }
      const paths = findDependencyDirs(dir);
      // the restore lands before the check because git needs the folders to read a rule like
      // `node_modules/` (a folder only). A tree the repository would commit is removed again.
      if (!(await allIgnored(dir, paths))) {
        for (const rel of paths) rmSync(join(dir, rel), { recursive: true, force: true });
        log(`depcache restore undone: the repository does not gitignore ${paths.join(' ')}`);
        return { action: 'skipped', reason: 'not-ignored' };
      }
      log(`depcache hit ${r.key}: ${paths.length} tree(s) in ${Date.now() - t0}ms`);
      return { action: 'hit', key: r.key, ms: Date.now() - t0, paths };
    },
    async remember(dir) {
      if (!hasLockfile(dir)) return { action: 'skipped', reason: 'no-lockfile' };
      const paths = findDependencyDirs(dir);
      if (!paths.length) return { action: 'skipped', reason: 'no-deps' };
      if (!(await allIgnored(dir, paths))) return { action: 'skipped', reason: 'not-ignored' };
      const t0 = Date.now();
      const r = await s.depSave(dir, paths);
      if (r.skipped) return { action: 'exists', key: r.key, ms: Date.now() - t0 };
      log(`depcache saved ${r.key}: ${paths.length} tree(s), ${r.result?.zBytes ?? 0} bytes in ${Date.now() - t0}ms`);
      return { action: 'saved', key: r.key, ms: Date.now() - t0, paths };
    },
  };

  /** THE HOST INSTALL (D17). Every way out that is not a filled worktree is a miss with its reason,
   *  and the worktree is left with no tree, so the agent installs as it did before */
  async function installOnMiss(dir: string, key: string, t0: number, phase?: (p: DepPhase) => void): Promise<DepNote> {
    const miss = (why: string): DepNote => { log(`depcache install skipped for ${key}: ${why}. The agent installs as before.`); return { action: 'miss', key, ms: Date.now() - t0, fallback: why }; };
    // the gitignore rail first, on an empty folder (git needs the folder to read `node_modules/`), so
    // no install fills a tree that a `git add -A` would commit
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    const ignored = await allIgnored(dir, ['node_modules']);
    if (!ignored) { rmSync(join(dir, 'node_modules'), { recursive: true, force: true }); return miss('not-ignored'); }
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    const before = new Set(findDependencyDirs(dir));
    phase?.('installing_dependencies');
    try {
      const out = await opts.install!.install(dir).catch((e: unknown): InstallOutcome => ({ ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) }));
      if (!out.ok) { removeNewTrees(dir, before); return miss(fallbackOf(out)); }
      const paths = findDependencyDirs(dir).filter((rel) => !before.has(rel));
      if (!paths.length) return miss('no-deps');
      // a nested tree in a folder the repository does not ignore: the same rail as a restore
      if (!(await allIgnored(dir, paths))) { removeNewTrees(dir, before); return miss('not-ignored'); }
      log(`depcache installed ${key}: ${out.pm}, ${paths.length} tree(s) in ${out.ms}ms, rebuild ${out.rebuilt}${out.rebuildProblem ? ` (${out.rebuildProblem})` : ''}`);
      // the snapshot runs behind the session: an upload must not hold up the first prompt
      if (out.store) {
        void cache.remember(dir).then(
          (n) => log(`depcache store after install ${key}: ${n.action === 'skipped' ? `skipped ${n.reason}` : n.action}`),
          (e: unknown) => log(`depcache store after install ${key} failed: ${e instanceof Error ? e.message : String(e)}`));
      } else log(`depcache install ${key}: not stored, because the lifecycle scripts did not run in the box`);
      return { action: 'installed', key, ms: Date.now() - t0, paths, stored: out.store ? 'saving' : 'held' };
    } finally {
      phase?.('dependencies_ready');
    }
  }

  return cache;
}
