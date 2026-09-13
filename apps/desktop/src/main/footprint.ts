// The agents' footprint (worktree-berths round, docs/design/worktree-berths-2026-08 §5).
//
// Machine-scoped disk truth for the Home card + the footprint destination: what NeuraMesh's own
// cache holds (berths · donors · clones, classed by the live board), what a sweep would reclaim
// right now (the same pure policy the sweeper runs — an ESTIMATE, never a second implementation),
// and what OTHER agent tools' workspace dirs weigh (report-only, never touched — deleting another
// tool's state is how trust dies). Sizes are APPARENT bytes; CoW-shared trees overstate real disk
// and every surface says so instead of faking a physical number.
//
// Disk-only and Electron-free; the sync.ts handler joins in the db rows (task titles/states,
// repo names/paths) and owns caching — a 73GB fleet scan is a du, not a hot-path readdir.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyBerth, decideSweep, capsFromEnv, type BerthClass, type SweepSnapshot } from './harness/berths';
import { readManifest } from './harness/donors';

export type FootprintBerth = { taskNumber: number; title: string | null; state: string | null; cls: BerthClass; bytes: number; mtimeMs: number; repoId: string | null; branch: string | null };
export type FootprintDonor = { repoId: string; repoName: string | null; hash: string; bytes: number; createdAt: string };
export type FootprintClone = { repoId: string; repoName: string | null; bytes: number; openTasks: number; mtimeMs: number };
export type FootprintFleet = { tool: string; path: string; count: number; bytes: number; oldestMs: number | null };
/** One line of the Clean-up preview, grouped by what the user would call it. */
export type FootprintPlanItem = { kind: 'finished' | 'submitted' | 'dependencies' | 'repos'; count: number; bytes: number };

export type FootprintPayload = {
  at: string;
  nm: {
    berths: FootprintBerth[];
    donors: FootprintDonor[];
    clones: FootprintClone[];
    deliverablesBytes: number;
    totalBytes: number;
    /** what one sweep would free right now — decided by the sweeper's own policy, not re-derived */
    reclaimableBytes: number;
    /** the same verdict, itemized for the Clean-up confirm: a TRUE preview, never a generic warning */
    plan: FootprintPlanItem[];
    /** the sweep budget (NM_CACHE_BUDGET_GB) — the ring's denominator */
    budgetBytes: number;
  };
  fleet: FootprintFleet[];
  history: SweepSnapshot[];
};

/** `du -sk`-fast apparent bytes; 0 for a missing path. (JS walks are 10× slower at fleet scale.) */
export async function duBytes(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('du', ['-sk', path]);
    return Number(stdout.split('\t')[0]) * 1024 || 0;
  } catch {
    return 0;
  }
}

/** The db rows the assembler joins in — the sync.ts handler queries these (footprint.ts has no db). */
export type FootprintDbRows = {
  tasks: Array<{ number: number; title: string | null; state: string; repo_id: string | null; branch: string | null }>;
  repos: Array<{ id: string; name: string | null; local_path: string | null }>;
  openByRepo: Array<{ repo_id: string; n: number }>;
};

export async function assembleFootprint(brainRootDir: string, rows: FootprintDbRows): Promise<FootprintPayload> {
  const cache = (kind: string, leaf?: string): string => (leaf ? join(brainRootDir, 'cache', kind, leaf) : join(brainRootDir, 'cache', kind));
  const taskByNumber = new Map(rows.tasks.map((t) => [t.number, t]));
  const repoById = new Map(rows.repos.map((r) => [r.id, r]));
  const openByRepo = new Map(rows.openByRepo.map((r) => [r.repo_id, r.n]));

  const berths: FootprintBerth[] = [];
  const wtRoot = cache('worktrees');
  for (const name of existsSync(wtRoot) ? readdirSync(wtRoot) : []) {
    const m = /^nm-(\d+)$/.exec(name);
    if (!m) continue;
    const num = Number(m[1]);
    const t = taskByNumber.get(num) ?? null;
    berths.push({
      taskNumber: num,
      title: t?.title ?? null,
      state: t?.state ?? null,
      cls: classifyBerth(t?.state ?? null),
      bytes: await duBytes(join(wtRoot, name)),
      mtimeMs: (() => { try { return statSync(join(wtRoot, name)).mtimeMs; } catch { return 0; } })(),
      repoId: t?.repo_id ?? null,
      branch: t?.branch ?? null,
    });
  }

  const donors: FootprintDonor[] = [];
  const donorRoot = cache('donors');
  for (const repoId of existsSync(donorRoot) ? readdirSync(donorRoot) : []) {
    for (const hash of readdirSync(join(donorRoot, repoId))) {
      const man = readManifest(join(donorRoot, repoId, hash));
      if (man) donors.push({ repoId, repoName: repoById.get(repoId)?.name ?? null, hash, bytes: man.apparentBytes, createdAt: man.createdAt });
    }
  }

  const clones: FootprintClone[] = [];
  const repoRoot = cache('repos');
  for (const repoId of existsSync(repoRoot) ? readdirSync(repoRoot) : []) {
    const dir = join(repoRoot, repoId);
    const fetchHead = join(dir, '.git', 'FETCH_HEAD');
    clones.push({
      repoId,
      repoName: repoById.get(repoId)?.name ?? null,
      bytes: await duBytes(dir),
      openTasks: openByRepo.get(repoId) ?? 0,
      mtimeMs: (() => { try { return statSync(existsSync(fetchHead) ? fetchHead : dir).mtimeMs; } catch { return 0; } })(),
    });
  }

  const deliverablesBytes = await duBytes(join(brainRootDir, 'deliverables'));

  // reclaimable = the sweeper's own verdict on this exact snapshot — policy reuse, zero drift
  const decided = decideSweep(
    berths.map((b) => ({ taskNumber: b.taskNumber, boardState: b.state, mtimeMs: b.mtimeMs, bytes: b.bytes, repoId: b.repoId, branch: b.branch })),
    donors.map((d) => ({ repoId: d.repoId, hash: d.hash, createdAt: d.createdAt, bytes: d.bytes })),
    clones.map((c) => ({ repoId: c.repoId, openTasks: c.openTasks, mtimeMs: c.mtimeMs, bytes: c.bytes })),
    capsFromEnv(),
  );
  let reclaimableBytes = 0;
  const groups: Record<FootprintPlanItem['kind'], { count: number; bytes: number }> = {
    finished: { count: 0, bytes: 0 }, submitted: { count: 0, bytes: 0 }, dependencies: { count: 0, bytes: 0 }, repos: { count: 0, bytes: 0 },
  };
  for (const a of decided) {
    let bytes = 0;
    let kind: FootprintPlanItem['kind'];
    if (a.kind === 'remove-berth' || a.kind === 'evict-berth') {
      bytes = berths.find((b) => b.taskNumber === a.taskNumber)?.bytes ?? 0;
      kind = a.kind === 'remove-berth' ? 'finished' : 'submitted';
    } else if (a.kind === 'drop-donor') {
      bytes = donors.find((d) => d.repoId === a.repoId && d.hash === a.hash)?.bytes ?? 0;
      kind = 'dependencies';
    } else {
      bytes = clones.find((c) => c.repoId === a.repoId)?.bytes ?? 0;
      kind = 'repos';
    }
    reclaimableBytes += bytes;
    groups[kind].count += 1;
    groups[kind].bytes += bytes;
  }
  const plan = (Object.keys(groups) as FootprintPlanItem['kind'][])
    .filter((k) => groups[k].count > 0)
    .map((k) => ({ kind: k, ...groups[k] }));

  const totalBytes = berths.reduce((n, b) => n + b.bytes, 0) + donors.reduce((n, d) => n + d.bytes, 0) + clones.reduce((n, c) => n + c.bytes, 0);
  return {
    at: new Date().toISOString(),
    nm: { berths, donors, clones, deliverablesBytes, totalBytes, reclaimableBytes, plan, budgetBytes: capsFromEnv().budgetBytes },
    fleet: [], // the handler fills this (it owns the location list + the slow-scan cache)
    history: await readHistory(brainRootDir),
  };
}

/** Watched third-party workspace locations: Codex global + <repo local_path>/.claude/worktrees. */
export function fleetLocations(homeDir: string, repos: FootprintDbRows['repos']): Array<{ tool: string; path: string }> {
  const out: Array<{ tool: string; path: string }> = [{ tool: 'Codex', path: join(homeDir, '.codex', 'worktrees') }];
  const seen = new Set<string>();
  for (const r of repos) {
    if (!r.local_path) continue;
    const p = join(r.local_path, '.claude', 'worktrees');
    if (!seen.has(p)) { seen.add(p); out.push({ tool: 'Claude Code', path: p }); }
  }
  return out;
}

export async function scanFleet(locations: Array<{ tool: string; path: string }>): Promise<FootprintFleet[]> {
  const out: FootprintFleet[] = [];
  for (const loc of locations) {
    if (!existsSync(loc.path)) continue;
    let entries: string[] = [];
    try { entries = readdirSync(loc.path).filter((n) => !n.startsWith('.')); } catch { /* unreadable → skip */ }
    if (!entries.length) continue;
    let oldest: number | null = null;
    for (const e of entries) {
      try { const ms = statSync(join(loc.path, e)).birthtimeMs || statSync(join(loc.path, e)).mtimeMs; oldest = oldest === null ? ms : Math.min(oldest, ms); } catch { /* raced */ }
    }
    out.push({ tool: loc.tool, path: loc.path, count: entries.length, bytes: await duBytes(loc.path), oldestMs: oldest });
  }
  return out;
}

export async function readHistory(brainRootDir: string, cap = 240): Promise<SweepSnapshot[]> {
  try {
    const raw = await readFile(join(brainRootDir, 'state', 'footprint-history.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).slice(-cap).map((l) => JSON.parse(l) as SweepSnapshot);
  } catch {
    return [];
  }
}
