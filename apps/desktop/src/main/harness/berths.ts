// Berth policy (worktree-berths round, docs/design/worktree-berths-2026-08 §3.1/§3.3).
//
// A task worktree is a BERTH: leased while the board says an agent may be working, warm once the
// work is submitted (the pushed branch + artifacts carry everything review needs), dead when the
// task settles. Berth state is DERIVED from the board at sweep time — never stored — the same
// ruling as journeyFor. This module is the pure half (stall.ts pattern: detection is code, the
// executor in agents.ts owns fs/git/db); given a snapshot of what exists and what the board says,
// it returns the actions a sweep must take. It never sees a path and never touches a disk.
//
// The one inviolable line: a LEASED berth is never an action, whatever the budget says — blocked
// counts as leased because a paused run can hold uncommitted work, and an UNKNOWN state counts as
// leased because the safe reading of a state this module has never heard of is "someone may be
// working". Eviction is safe only where rebuild is proven: fresh-per-attempt checkout + donors.

export type BerthClass = 'leased' | 'warm' | 'dead' | 'orphan';

/** Submitted, nothing locally load-bearing — evictable under pressure, newest kept. */
const WARM_STATES = new Set(['in_review', 'done', 'shipping', 'releasing', 'verifying']);
/** Settled — the reclaim watch's territory; the sweep converges anything the watch missed. */
const DEAD_STATES = new Set(['accepted', 'closed']);

export function classifyBerth(boardState: string | null): BerthClass {
  if (boardState === null) return 'orphan';
  if (DEAD_STATES.has(boardState)) return 'dead';
  if (WARM_STATES.has(boardState)) return 'warm';
  return 'leased';
}

export type BerthEntry = { taskNumber: number; boardState: string | null; mtimeMs: number; bytes: number; repoId: string | null; branch: string | null };
export type DonorEntry = { repoId: string; hash: string; createdAt: string; bytes: number };
export type CloneEntry = { repoId: string; openTasks: number; mtimeMs: number; bytes: number };

export type SweepCaps = {
  /** warm berths kept, newest first (NM_WARM_BERTHS, default 4) */
  warmMax: number;
  /** apparent-bytes budget for cache/ as a whole (NM_CACHE_BUDGET_GB, default 20) */
  budgetBytes: number;
};

export type SweepAction =
  | { kind: 'remove-berth'; taskNumber: number; repoId: string | null; branch: string | null; reason: 'dead' | 'orphan' }
  | { kind: 'evict-berth'; taskNumber: number; repoId: string | null; branch: string | null; reason: 'warm-cap' | 'budget' }
  | { kind: 'drop-donor'; repoId: string; hash: string; reason: 'budget' }
  | { kind: 'drop-clone'; repoId: string; reason: 'budget' };

export const DEFAULT_CAPS: SweepCaps = { warmMax: 4, budgetBytes: 20e9 };

export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): SweepCaps {
  const warm = Number(env['NM_WARM_BERTHS']);
  const gb = Number(env['NM_CACHE_BUDGET_GB']);
  return {
    warmMax: Number.isFinite(warm) && warm >= 0 ? Math.floor(warm) : DEFAULT_CAPS.warmMax,
    budgetBytes: Number.isFinite(gb) && gb > 0 ? gb * 1e9 : DEFAULT_CAPS.budgetBytes,
  };
}

/**
 * Decide a sweep. Deterministic, total-ordered, and idempotent on its own output: applying the
 * actions and re-running yields none (what convergence means for a GC).
 *
 * Order: dead/orphan berths go unconditionally → warm berths beyond the cap (oldest first) →
 * then, while the apparent total still exceeds the budget: the remaining oldest warm berths,
 * donors beyond the newest per repo, clones of repos with no open tasks (oldest first). Leased
 * berths and each repo's newest donor survive any budget — a floor, not a target: the budget can
 * be exceeded by protected state, and the honest answer to that is a bigger disk, not a sweep
 * that eats the newest donor it exists to keep.
 */
export function decideSweep(
  berths: BerthEntry[],
  donors: DonorEntry[],
  clones: CloneEntry[],
  caps: SweepCaps = DEFAULT_CAPS,
): SweepAction[] {
  const actions: SweepAction[] = [];
  const gone = new Set<number>();
  const remove = (b: BerthEntry, reason: 'dead' | 'orphan'): void => {
    gone.add(b.taskNumber);
    actions.push({ kind: 'remove-berth', taskNumber: b.taskNumber, repoId: b.repoId, branch: b.branch, reason });
  };
  const evictWarm = (b: BerthEntry, reason: 'warm-cap' | 'budget'): void => {
    gone.add(b.taskNumber);
    actions.push({ kind: 'evict-berth', taskNumber: b.taskNumber, repoId: b.repoId, branch: b.branch, reason });
  };

  // 1 — settled and orphaned berths go, budget or not
  for (const b of berths) {
    const c = classifyBerth(b.boardState);
    if (c === 'dead') remove(b, 'dead');
    else if (c === 'orphan') remove(b, 'orphan');
  }

  // 2 — the warm cap, oldest evicted first
  const warm = berths
    .filter((b) => !gone.has(b.taskNumber) && classifyBerth(b.boardState) === 'warm')
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  for (const b of warm.slice(0, Math.max(0, warm.length - caps.warmMax))) evictWarm(b, 'warm-cap');

  // 3 — budget pressure, cheapest-to-lose first
  const droppedDonor = new Set<string>();
  const droppedClone = new Set<string>();
  const total = (): number =>
    berths.filter((b) => !gone.has(b.taskNumber)).reduce((n, b) => n + b.bytes, 0) +
    donors.filter((d) => !droppedDonor.has(`${d.repoId}/${d.hash}`)).reduce((n, d) => n + d.bytes, 0) +
    clones.filter((c) => !droppedClone.has(c.repoId)).reduce((n, c) => n + c.bytes, 0);

  const stillWarm = (): BerthEntry[] =>
    berths.filter((b) => !gone.has(b.taskNumber) && classifyBerth(b.boardState) === 'warm').sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (total() > caps.budgetBytes && stillWarm().length) evictWarm(stillWarm()[0]!, 'budget');

  if (total() > caps.budgetBytes) {
    // donors beyond the newest per repo, oldest first across repos
    const byRepo = new Map<string, DonorEntry[]>();
    for (const d of donors) byRepo.set(d.repoId, [...(byRepo.get(d.repoId) ?? []), d]);
    const spare = [...byRepo.values()]
      .flatMap((list) => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(1))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const d of spare) {
      if (total() <= caps.budgetBytes) break;
      droppedDonor.add(`${d.repoId}/${d.hash}`);
      actions.push({ kind: 'drop-donor', repoId: d.repoId, hash: d.hash, reason: 'budget' });
    }
  }

  if (total() > caps.budgetBytes) {
    // clones of repos with no open tasks, least-recently-fetched first
    for (const c of clones.filter((x) => x.openTasks === 0).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total() <= caps.budgetBytes) break;
      droppedClone.add(c.repoId);
      actions.push({ kind: 'drop-clone', repoId: c.repoId, reason: 'budget' });
    }
  }

  return actions;
}

/** One sweep's ledger line + the history snapshot the footprint chart grows from. */
export type SweepSnapshot = {
  at: string;
  berths: { leased: number; warm: number; bytes: number };
  donorsBytes: number;
  clonesBytes: number;
  actions: number;
  reclaimedBytes: number;
};
