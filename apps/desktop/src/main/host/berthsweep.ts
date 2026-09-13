// THE BERTH SWEEP — the one owner of `cache/` (docs/40).
//
// Split out of agents.ts, where it sat inside startAgentHost as ~105 lines. Policy is pure
// (harness/berths.ts); this is the EXECUTOR: it gathers what exists on disk + what the board
// says about each berth, applies the decided actions, and appends one history snapshot per
// sweep — the sample the footprint chart grows from.
//
// What deliberately did NOT move: the boot pass, the 6h interval, and the `berthSweepLive`
// hand-off. A timer's arming moment is part of the boot sequence, and burying it in a maker is
// how a subscription silently never attaches. They stay in startAgentHost, reading as wiring.
// The 30s post-reclaim debounce DID move, because that is the sweep's own policy, not boot's.
import { decideSweep, capsFromEnv, classifyBerth } from '../harness/berths';
import { cachePath, deliverablePath } from '../harness/brain';
import { treeBytes, readManifest } from '../harness/donors';
import { removeTaskWorkspace } from '../harness/workspaces';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';

export function makeBerthSweep(ctx: {
  db: PowerSyncDatabase;
  brain: Brain;
  withRepoLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  /** startAgentHost's own option — a dead berth's terminals die with it */
  killTaskPtys?: (taskNumber: number) => void;
}) {
  const { db, brain, withRepoLock, killTaskPtys } = ctx;

  // ── the berth sweep: ONE owner for cache/ (worktree-berths round) ──────────────────────────
  // Policy is pure (harness/berths.ts); this executor gathers what exists + what the board says,
  // applies the decided actions, and appends one history snapshot per sweep — the sample the
  // footprint chart grows from. Triggers: boot (+2min), every 6h, debounced after any reclaim,
  // and the footprint card's Reclaim-now via berthSweepNow().
  const runBerthSweep = async (): Promise<import('../harness/berths').SweepSnapshot> => {
    const { readdirSync, statSync, existsSync, appendFileSync, readFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const caps = capsFromEnv();

    const berthEntries: import('../harness/berths').BerthEntry[] = [];
    const wtRoot = cachePath('worktrees');
    for (const name of existsSync(wtRoot) ? readdirSync(wtRoot) : []) {
      const m = /^nm-(\d+)$/.exec(name);
      if (!m) continue;
      const num = Number(m[1]);
      const dir = join(wtRoot, name);
      const row = await db.get<{ state: string; repo_id: string | null; branch: string | null }>(
        'select state, repo_id, branch from tasks where number = ?', [num],
      ).catch(() => null);
      berthEntries.push({
        taskNumber: num,
        boardState: row?.state ?? null,
        mtimeMs: (() => { try { return statSync(dir).mtimeMs; } catch { return 0; } })(),
        bytes: treeBytes(dir),
        repoId: row?.repo_id ?? null,
        branch: row?.branch ?? `nm/${num}`,
      });
    }

    const donorEntries: import('../harness/berths').DonorEntry[] = [];
    const donorRoot = cachePath('donors');
    for (const repoId of existsSync(donorRoot) ? readdirSync(donorRoot) : []) {
      for (const hash of readdirSync(join(donorRoot, repoId))) {
        const man = readManifest(join(donorRoot, repoId, hash));
        if (man) donorEntries.push({ repoId, hash, createdAt: man.createdAt, bytes: man.apparentBytes });
      }
    }

    const open = await db.getAll<{ repo_id: string; n: number }>(
      `select repo_id, count(*) as n from tasks where repo_id is not null and state not in ('accepted','closed') group by repo_id`,
    ).catch(() => [] as Array<{ repo_id: string; n: number }>);
    const openByRepo = new Map(open.map((r) => [r.repo_id, r.n]));
    const cloneEntries: import('../harness/berths').CloneEntry[] = [];
    const repoRoot = cachePath('repos');
    for (const repoId of existsSync(repoRoot) ? readdirSync(repoRoot) : []) {
      const dir = join(repoRoot, repoId);
      const fetchHead = join(dir, '.git', 'FETCH_HEAD');
      cloneEntries.push({
        repoId,
        openTasks: openByRepo.get(repoId) ?? 0,
        mtimeMs: (() => { try { return statSync(existsSync(fetchHead) ? fetchHead : dir).mtimeMs; } catch { return 0; } })(),
        bytes: treeBytes(dir),
      });
    }

    const actions = decideSweep(berthEntries, donorEntries, cloneEntries, caps);
    let reclaimedBytes = 0;
    for (const a of actions) {
      if (a.kind === 'remove-berth' || a.kind === 'evict-berth') {
        const b = berthEntries.find((x) => x.taskNumber === a.taskNumber);
        reclaimedBytes += b?.bytes ?? 0;
        killTaskPtys?.(a.taskNumber);
        const remove = () => removeTaskWorkspace({
          wtDir: cachePath('worktrees', `nm-${a.taskNumber}`),
          deliverableDir: a.kind === 'remove-berth' ? deliverablePath(a.taskNumber) : null, // eviction ≠ settle: scratch stays
          cloneDir: a.repoId ? cachePath('repos', a.repoId) : null,
          branch: a.branch,
        });
        await (a.repoId ? withRepoLock(a.repoId, remove) : remove()).catch(() => [] as string[]);
      } else if (a.kind === 'drop-donor') {
        reclaimedBytes += donorEntries.find((d) => d.repoId === a.repoId && d.hash === a.hash)?.bytes ?? 0;
        const { rm } = await import('node:fs/promises');
        await rm(join(donorRoot, a.repoId, a.hash), { recursive: true, force: true }).catch(() => {});
      } else {
        reclaimedBytes += cloneEntries.find((c) => c.repoId === a.repoId)?.bytes ?? 0;
        const { rm } = await import('node:fs/promises');
        await withRepoLock(a.repoId, () => rm(join(repoRoot, a.repoId), { recursive: true, force: true })).catch(() => {});
      }
    }

    const goneNums = new Set(actions.filter((a) => 'taskNumber' in a).map((a) => (a as { taskNumber: number }).taskNumber));
    const kept = berthEntries.filter((b) => !goneNums.has(b.taskNumber));
    const snapshot: import('../harness/berths').SweepSnapshot = {
      at: new Date().toISOString(),
      berths: {
        leased: kept.filter((b) => classifyBerth(b.boardState) === 'leased').length,
        warm: kept.filter((b) => classifyBerth(b.boardState) === 'warm').length,
        bytes: kept.reduce((n, b) => n + b.bytes, 0),
      },
      donorsBytes: donorEntries.filter((d) => !actions.some((a) => a.kind === 'drop-donor' && a.repoId === d.repoId && a.hash === d.hash)).reduce((n, d) => n + d.bytes, 0),
      clonesBytes: cloneEntries.filter((c) => !actions.some((a) => a.kind === 'drop-clone' && a.repoId === c.repoId)).reduce((n, c) => n + c.bytes, 0),
      actions: actions.length,
      reclaimedBytes,
    };
    // the history file the chart reads — append-only JSONL in state/ (Tier B), capped in place
    try {
      const hist = join(brain.root, 'state', 'footprint-history.jsonl');
      appendFileSync(hist, JSON.stringify(snapshot) + '\n');
      const lines = readFileSync(hist, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 1000) writeFileSync(hist, lines.slice(-500).join('\n') + '\n');
    } catch { /* history is nice-to-have, never the sweep's failure */ }
    if (actions.length) console.log(`berth_sweep: ${actions.length} action(s), ~${Math.round(reclaimedBytes / 1e6)}MB apparent reclaimed`);
    return snapshot;
  };
  // debounced re-sweep after any reclaim — the sweep's OWN policy, so it lives with the sweep
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleBerthSweep = (): void => {
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => { void runBerthSweep().catch(() => {}); }, 30_000);
  };

  return { runBerthSweep, scheduleBerthSweep };
}
