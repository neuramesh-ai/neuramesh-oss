// Whiteboards (docs/38): the renderer's pure half — watch-row parsing, the two staleness
// questions every mount asks (does this board still need its scene materialized? is the
// snapshot behind the scene it pictures?), and the destination's day grouping. Kept beside
// wtabs.ts/room-tabs.ts and tested from src/main, so the invariants are provable without a
// renderer. No Excalidraw import here — the heavy library stays a lazy chunk of the view.
import { parseWhiteboardSource, type WhiteboardSource } from '@neuramesh/shared';

export interface WbRow {
  id: string;
  channelId: string;
  channelSlug: string;
  threadId: string | null;
  taskId: string | null;
  title: string;
  /** the scene JSON text — present only on the single-board watch; the list stays lean */
  scene: string | null;
  /** a pending agent generation source, parsed; null once materialized */
  source: WhiteboardSource | null;
  snapshotSvg: string | null;
  snapshotRev: number;
  rev: number;
  archivedAt: string | null;
  createdByKind: 'human' | 'agent';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);

/** A watch row → WbRow. Lenient like every other row parser: a bad row is null, never a throw. */
export function parseWbRow(raw: unknown): WbRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r['id']);
  const channelId = str(r['channel_id']);
  if (!id || !channelId) return null;
  return {
    id,
    channelId,
    channelSlug: str(r['channel_slug']) ?? '',
    threadId: str(r['thread_id']),
    taskId: str(r['task_id']),
    title: str(r['title']) ?? 'Untitled board',
    scene: str(r['scene']),
    source: parseWhiteboardSource(str(r['source'])),
    snapshotSvg: str(r['snapshot_svg']),
    snapshotRev: int(r['snapshot_rev'], 0),
    rev: int(r['rev'], 1),
    archivedAt: str(r['archived_at']),
    createdByKind: r['created_by_kind'] === 'agent' ? 'agent' : 'human',
    createdBy: str(r['created_by']) ?? '',
    createdAt: str(r['created_at']) ?? '',
    updatedAt: str(r['updated_at']) ?? '',
  };
}

/**
 * Does this board still carry an unrealized generation source? Materializing is the FIRST
 * renderer's job (conversion needs a DOM, the daemon never renders — docs/38 §4); the strict
 * command lane's rev guard makes the race one-winner, so asking is cheap and safe everywhere.
 */
export const wbNeedsMaterialize = (r: Pick<WbRow, 'source'>): boolean => !!r.source;

/**
 * Is the stored still older than the scene it claims to picture? True after a save that could
 * not export (and for agent-edited boards until re-materialize) — the open editor re-exports
 * on its next idle save; cards render the stale still rather than nothing.
 */
export const wbSnapshotStale = (r: Pick<WbRow, 'snapshotRev' | 'rev' | 'snapshotSvg'>): boolean =>
  !r.snapshotSvg || r.snapshotRev < r.rev;

/** The snapshot as an <img> src — SVG text rides as a data URI (never innerHTML'd). */
export function wbSnapshotSrc(svg: string | null): string | null {
  if (!svg) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ── the destination's day grouping ────────────────────────────────────────────────────────────
// The session list's calendar semantics exactly (room-tabs.ts sessionGroups): boundaries are
// LOCAL days, `now` is injected so tests can pin them, empty buckets are omitted, and a row
// whose timestamp won't parse lands in Earlier — shown, not vanished.

export type WbBucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
const WB_BUCKETS: WbBucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

function dayStart(ms: number, back: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

export interface WbGroup {
  label: WbBucket;
  rows: WbRow[];
}

export function whiteboardGroups(rows: WbRow[], nowMs: number): WbGroup[] {
  const today = dayStart(nowMs, 0);
  const yesterday = dayStart(nowMs, 1);
  const week = dayStart(nowMs, 6);
  const held = new Map<WbBucket, WbRow[]>();
  for (const r of rows) {
    const at = Date.parse(r.updatedAt);
    const label: WbBucket = at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : at >= week ? 'This week' : 'Earlier';
    const bucket = held.get(label);
    if (bucket) bucket.push(r);
    else held.set(label, [r]);
  }
  return WB_BUCKETS.filter((label) => held.has(label)).map((label) => ({ label, rows: held.get(label) as WbRow[] }));
}
