// SNAPSHOT RETENTION (architecture §4, R17). Every drain writes `work-e<N>` and, while the box lives,
// `box-e<N>` under the machine's prefix (machine-snapshots.ts snapshotPrefix). Nothing deleted them:
// the e2e bucket's 30-day age rule did, which in production would also take the ONLY work snapshot of
// a workspace asleep for a month. So production runs the bucket with no age rule, and nm-api deletes
// what a restore can no longer reach:
//
//   kept   the newest NM_SNAPSHOT_KEEP (3) epochs of work and, separately, of box. A boot restores the
//          named work snapshot first and falls back to older stored epochs, newest first (machined
//          lifecycle.ts fallbackKeys), so the newest epochs are what it reads
//   kept   whatever the row points at (snapshot_work, snapshot_box): the next boot's restore point,
//          however old it is
//   kept   any object written in the last NM_SNAPSHOT_GC_MIN_AGE_MIN minutes (60): a drain uploads
//          before it reports, so a fresh key may not be on the row yet
//   kept   a key this code does not recognise
//   gone   every other `work-e<N>` and `box-e<N>`
//
// It runs inside the machine sweep cron, bounded: at most NM_SNAPSHOT_GC_MACHINES machines a pass
// (20, 0 = off), at most NM_SNAPSHOT_GC_MAX_DELETES deletes (200) and NM_SNAPSHOT_GC_BUDGET_MS (20 s).
// A machine is visited only when its restore point moved since its last clean (snapshot_gc_work,
// 0158), oldest clean first. Races are safe by construction: a key written after the listing is not
// in it, and a pointer that moves after the read only points at something newer, which is kept.
import type postgres from 'postgres';
import { configuredSnapshotStorage, type SnapshotStorage } from './gcs-sign';
import { LIST_MAX, snapshotKeyOf, snapshotPrefix } from './machine-snapshots';

const intEnv = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export interface RetentionConfig {
  keep: number;
  machines: number;
  maxDeletes: number;
  minAgeMs: number;
  budgetMs: number;
}

export function retentionConfig(): RetentionConfig {
  return {
    keep: intEnv('NM_SNAPSHOT_KEEP', 3, 1, 50),
    machines: intEnv('NM_SNAPSHOT_GC_MACHINES', 20, 0, 500),
    maxDeletes: intEnv('NM_SNAPSHOT_GC_MAX_DELETES', 200, 1, 10_000),
    minAgeMs: intEnv('NM_SNAPSHOT_GC_MIN_AGE_MIN', 60, 0, 7 * 24 * 60) * 60_000,
    budgetMs: intEnv('NM_SNAPSHOT_GC_BUDGET_MS', 20_000, 1_000, 120_000),
  };
}

export interface ListedKey { key: string; updatedMs?: number | null }

const EPOCH_KEY = /^(work|box)-e(\d+)$/;

/** the keys a machine no longer needs, pure. `pointed` is the row's restore point */
export function supersededKeys(listed: ReadonlyArray<ListedKey>, pointed: { work: string | null; box: string | null }, cfg: Pick<RetentionConfig, 'keep' | 'minAgeMs'>, nowMs: number): string[] {
  // Manifest chunks and original full archives stay protected until a reachability-aware
  // collector is introduced. Age alone cannot tell whether a cold segment is still referenced.
  if (pointed.work?.startsWith('manifest-e')) return [];
  const byKind: Record<'work' | 'box', Array<{ key: string; epoch: number; updatedMs: number | null }>> = { work: [], box: [] };
  for (const o of listed) {
    const m = EPOCH_KEY.exec(o.key);
    if (m) byKind[m[1] as 'work' | 'box'].push({ key: o.key, epoch: Number(m[2]), updatedMs: o.updatedMs ?? null });
  }
  const keep = new Set<string>([pointed.work, pointed.box].filter((k): k is string => !!k));
  const doomed: string[] = [];
  for (const kind of ['work', 'box'] as const) {
    const sorted = byKind[kind].sort((a, b) => b.epoch - a.epoch);
    sorted.slice(0, cfg.keep).forEach((o) => keep.add(o.key));
    for (const o of sorted.slice(cfg.keep)) {
      if (keep.has(o.key)) continue;
      // a key whose age is unknown is treated as fresh: the listing always names it, so this only
      // happens with a storage that cannot say, and keeping it is the safe side
      if (o.updatedMs === null || nowMs - o.updatedMs < cfg.minAgeMs) continue;
      doomed.push(o.key);
    }
  }
  return doomed;
}

export interface RetentionResult {
  machines: number;
  deleted: number;
  kept: number;
  /** the pass stopped at its delete or time budget; the rest waits for the next pass */
  truncated: boolean;
  errors: string[];
}

type RetentionStorage = Required<Pick<SnapshotStorage, 'list' | 'remove'>>;

interface Candidate { id: string; workspace_id: string; snapshot_work: string; snapshot_box: string | null }

/** one bounded pass. Never throws for one machine: its error is reported and the pass moves on */
export async function snapshotRetentionPass(sql: postgres.Sql, storage: SnapshotStorage | null = configuredSnapshotStorage(), cfg: RetentionConfig = retentionConfig(), now: () => number = Date.now): Promise<RetentionResult | null> {
  if (!storage?.list || !storage.remove || cfg.machines === 0) return null;
  const store: RetentionStorage = { list: storage.list.bind(storage), remove: storage.remove.bind(storage) };
  const out: RetentionResult = { machines: 0, deleted: 0, kept: 0, truncated: false, errors: [] };
  const deadline = now() + cfg.budgetMs;
  const rows = await sql<Candidate[]>`
    select id, workspace_id, snapshot_work, snapshot_box from machines
     where substrate = 'cloudrun' and snapshot_work is not null
       and (lifecycle is null or lifecycle <> 'destroyed')
       and snapshot_gc_work is distinct from snapshot_work
     order by snapshot_gc_at nulls first
     limit ${cfg.machines}`;
  for (const row of rows) {
    if (now() >= deadline || out.deleted >= cfg.maxDeletes) { out.truncated = true; break; }
    out.machines += 1;
    const base = snapshotPrefix(row.workspace_id, row.id);
    try {
      const objects = await store.list(base, LIST_MAX);
      const listed = objects.flatMap((o) => {
        const key = snapshotKeyOf(base, o.name);
        const t = o.updated ? Date.parse(o.updated) : NaN;
        return key ? [{ key, updatedMs: Number.isFinite(t) ? t : null }] : [];
      });
      const doomed = supersededKeys(listed, { work: row.snapshot_work, box: row.snapshot_box }, cfg, now());
      let done = true;
      for (const key of doomed) {
        if (now() >= deadline || out.deleted >= cfg.maxDeletes) { out.truncated = true; done = false; break; }
        await store.remove(`${base}${key}.tar.zst`);
        out.deleted += 1;
      }
      out.kept += listed.length - doomed.length;
      // a machine cut short keeps its old mark, so the next pass comes back to it
      await sql`update machines set snapshot_gc_at = now(),
                       snapshot_gc_work = case when ${done} then ${row.snapshot_work}::text else snapshot_gc_work end
                 where id = ${row.id}::uuid`;
      if (doomed.length) console.log(`snapshot_retention machine=${row.id} deleted=${doomed.length} kept=${listed.length - doomed.length} pointed=${row.snapshot_work},${row.snapshot_box ?? '-'}${done ? '' : ' (cut short)'}`);
    } catch (e) {
      out.errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      await sql`update machines set snapshot_gc_at = now() where id = ${row.id}::uuid`.catch(() => {});
    }
  }
  return out;
}

// ── THE DEPCACHE PASS ────────────────────────────────────────────────────────────────────────────
// The dependency cache (`v1/workspaces/<ws>/depcache/<key>.tar.zst`, machine-snapshots.ts) relied on
// the bucket's 30-day age rule too, and a lifecycle prefix cannot match the workspace segment in the
// middle. So this pass deletes a depcache object nobody used for NM_DEPCACHE_MAX_IDLE_DAYS (30). A
// use is a download through the sign route, which stamps the object's customTime; an upload is a use
// too (`updated`). The newer of the two counts. Bounded like the snapshot pass: at most
// NM_DEPCACHE_GC_LIST_MAX objects listed a pass (1000, 0 = off) and NM_DEPCACHE_GC_MAX_DELETES (200).
// The listing resumes where the last pass stopped (an in-memory cursor; a restart begins again at the
// start, which costs one extra listing and nothing else) and wraps at the end.

export const DEPCACHE_GLOB = 'v1/workspaces/*/depcache/*.tar.zst';
const DEPCACHE_ROOT = 'v1/workspaces/';

export interface DepcacheConfig { idleMs: number; listMax: number; maxDeletes: number; budgetMs: number }
export function depcacheConfig(): DepcacheConfig {
  return {
    idleMs: intEnv('NM_DEPCACHE_MAX_IDLE_DAYS', 30, 1, 3650) * 24 * 3600_000,
    listMax: intEnv('NM_DEPCACHE_GC_LIST_MAX', 1000, 0, 10_000),
    maxDeletes: intEnv('NM_DEPCACHE_GC_MAX_DELETES', 200, 1, 10_000),
    budgetMs: intEnv('NM_SNAPSHOT_GC_BUDGET_MS', 20_000, 1_000, 120_000),
  };
}

export interface DepcacheObject { name: string; updatedMs: number | null; usedMs: number | null }

/** the objects idle longer than the limit, pure. An object of unknown age is kept */
export function staleDepcache(listed: ReadonlyArray<DepcacheObject>, idleMs: number, nowMs: number): string[] {
  return listed.flatMap((o) => {
    const last = Math.max(o.updatedMs ?? -Infinity, o.usedMs ?? -Infinity);
    return Number.isFinite(last) && nowMs - last > idleMs ? [o.name] : [];
  });
}

export interface DepcacheResult { listed: number; deleted: number; truncated: boolean; wrapped: boolean; errors: string[] }

/** where the next pass resumes its listing; '' = from the start */
export const depcacheCursor = { next: '' };

const ms = (v: string | undefined): number | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

export async function depcachePass(storage: SnapshotStorage | null = configuredSnapshotStorage(), cfg: DepcacheConfig = depcacheConfig(), now: () => number = Date.now, cursor: { next: string } = depcacheCursor): Promise<DepcacheResult | null> {
  if (!storage?.list || !storage.remove || cfg.listMax === 0) return null;
  const deadline = now() + cfg.budgetMs;
  const out: DepcacheResult = { listed: 0, deleted: 0, truncated: false, wrapped: false, errors: [] };
  const objects = await storage.list(DEPCACHE_ROOT, cfg.listMax, { matchGlob: DEPCACHE_GLOB, ...(cursor.next ? { startOffset: cursor.next } : {}) });
  out.listed = objects.length;
  const listed = objects.map((o) => ({ name: o.name, updatedMs: ms(o.updated), usedMs: ms(o.customTime) }));
  const doomed = staleDepcache(listed, cfg.idleMs, now());
  let stoppedAt: string | null = null;
  for (const name of doomed) {
    if (now() >= deadline || out.deleted >= cfg.maxDeletes) { out.truncated = true; stoppedAt = name; break; }
    try {
      await storage.remove(name);
      out.deleted += 1;
    } catch (e) {
      out.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  }
  // the next pass resumes at the first object this one did not finish, or after the listing's end
  if (stoppedAt) cursor.next = stoppedAt;
  else if (objects.length < cfg.listMax) { cursor.next = ''; out.wrapped = true; }
  else cursor.next = objects[objects.length - 1]!.name;
  if (out.deleted) console.log(`depcache_retention deleted=${out.deleted} listed=${out.listed} idleDays=${Math.round(cfg.idleMs / 86_400_000)}${out.truncated ? ' (cut short)' : ''}`);
  return out;
}
