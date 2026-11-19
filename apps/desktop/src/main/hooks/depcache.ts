// The dependency cache hook: what a worktree asks before its agent installs anything. Unset, a
// worktree installs as it always did. A Cloud Run machine sets the GCS cache (cloudrun/depcache.ts).

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
