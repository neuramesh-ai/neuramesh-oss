// WHAT OPENS BY ITSELF (the side-panel round, 2026-10-03, docs/design/side-panel-2026-10 §3.4) — pure,
// so the rules are tested, not eyeballed.
//
// When a session makes something while you look at it (a plan, a design round, a report, drafts, a
// board), it opens in the side panel by itself. Two questions decide that, and both live here:
//
// 1. IS IT NEW? No watch marks "new since you opened the session": every watch delivers the full set,
//    and a slow sync can deliver an OLD row late. So a session keeps what it showed while it settled
//    (the first `SETTLE_MS` after it opened) as its baseline: those ids, and the newest server time
//    among them. A later row is new only when its id is not in the baseline AND its server time is
//    later than that floor. Both sides are server times, so a slow client clock changes nothing. A
//    session that showed nothing while it settled falls back to a floor two minutes before it opened.
// 2. WHERE DOES IT GO? In front, unless the front tab holds your unsaved work (then behind it, with a
//    dot), or unless you folded the panel while an agent worked (then behind, and the panel stays
//    folded until that run ends). When several land together, one opens in front: a gate first.

/** a row a watch delivers: its id, and its server time */
export interface ArrivalRow { id: string; created_at?: string | null }

/** how long a session's first deliveries count as what was already there */
export const SETTLE_MS = 1500;
/** the floor for a session that showed nothing while it settled: a row older than this before the open is not new */
export const EMPTY_FLOOR_MS = 120_000;

/** a server time as epoch ms. Postgres text (`2026-10-03 20:41:00.123+00`) and ISO both read; anything else is null. */
export function serverMs(s: string | null | undefined): number | null {
  if (!s) return null;
  let t = s.trim().replace(' ', 'T');
  // `+00` or `-0530` style offsets: Date wants `+00:00`
  t = t.replace(/([+-]\d{2})(\d{2})?$/, (_m, h: string, mm?: string) => `${h}:${mm ?? '00'}`);
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

export interface SeenState {
  /** the session this state belongs to */
  key: string;
  /** when the session opened, on this client's clock (only the settle window reads it) */
  openedAt: number;
  ids: Set<string>;
  /** the newest server time the session showed while it settled */
  floor: number | null;
}

export function seenStart(key: string, now: number): SeenState {
  return { key, openedAt: now, ids: new Set(), floor: null };
}

/**
 * Note one delivery. Returns the rows that are NEW, and records every row it saw so each arrival is
 * reported once. Mutates `st` on purpose: it lives in a ref, and a delivery is an event, not a render.
 */
export function noteRows<T extends ArrivalRow>(st: SeenState, rows: readonly T[], now: number): T[] {
  const settling = now - st.openedAt < SETTLE_MS;
  const fresh: T[] = [];
  for (const r of rows) {
    if (st.ids.has(r.id)) continue;
    st.ids.add(r.id);
    const t = serverMs(r.created_at);
    if (settling) {
      if (t != null && (st.floor == null || t > st.floor)) st.floor = t;
      continue;
    }
    const floor = st.floor ?? st.openedAt - EMPTY_FLOOR_MS;
    if (t != null && t > floor) fresh.push(r);
  }
  return fresh;
}

/**
 * A coding session's pending approval, as an arrival (George, 2026-10-05: only a new artifact opens
 * the panel). It carries no server time, so the settle window is its whole baseline: an approval the
 * session showed in its first `SETTLE_MS` already waited (the cache at mount, the first events after
 * a load), and only one that appears later is new. Records `id`, so each approval counts once.
 */
export function noteApproval(st: SeenState, id: string | null | undefined, now: number): boolean {
  if (!id || st.ids.has(id)) return false;
  st.ids.add(id);
  return now - st.openedAt >= SETTLE_MS;
}

/** what kind of thing landed — the order one of a burst opens in front */
export type ArrivalKind = 'gate' | 'drafts' | 'doc' | 'page' | 'article' | 'board' | 'image' | 'diff';
export const ARRIVAL_RANK: Record<ArrivalKind, number> = { gate: 0, drafts: 1, doc: 2, page: 2, article: 2, board: 3, image: 4, diff: 5 };

/** a produced file's kind, from its name and the artifact kind (a review is decided by the caller) */
export function fileArrivalKind(name: string, kind?: string | null): Exclude<ArrivalKind, 'gate' | 'drafts' | 'article' | 'board'> {
  const n = name.toLowerCase();
  if (kind === 'diff' || /\.(patch|diff)$/.test(n)) return 'diff';
  if (kind === 'screenshot' || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return 'image';
  if (kind === 'design' || /\.html?$/.test(n)) return 'page';
  return 'doc';
}

export interface ArrivalDecision<T> {
  /** the one that comes to the front, if any */
  front: T | null;
  /** the rest: they join the strip behind the front tab, each with a dot */
  behind: T[];
  /** whether the panel unfolds */
  unfold: boolean;
}

/**
 * Where a burst of arrivals goes. `frontBusy`: the front tab holds your work (an unsaved edit, or
 * review comments you did not send). `hold`: you folded the panel while an agent worked, and that run
 * has not ended.
 */
export function decideArrivals<T extends { kind: ArrivalKind }>(list: readonly T[], s: { frontBusy: boolean; hold: boolean }): ArrivalDecision<T> {
  if (!list.length) return { front: null, behind: [], unfold: false };
  // a stable sort: within one rank, the order they landed in
  const sorted = list.map((a, i) => ({ a, i })).sort((x, y) => ARRIVAL_RANK[x.a.kind] - ARRIVAL_RANK[y.a.kind] || x.i - y.i).map((x) => x.a);
  if (s.hold) return { front: null, behind: sorted, unfold: false };
  if (s.frontBusy) return { front: null, behind: sorted, unfold: true };
  return { front: sorted[0]!, behind: sorted.slice(1), unfold: true };
}

/**
 * One thing that landed, as the thread hands it to the shell: what kind it is, and how to open it.
 * `task` opens through the task's own door (a review under a gate, else a read-only file); `doc`
 * carries its bytes (a conversation's file); `artifact` names a row the shell reads first (a report,
 * a brief, an article); `board` is a whiteboard an agent drew.
 */
export type PanelArrival =
  | { kind: ArrivalKind; via: 'task'; name: string }
  | { kind: ArrivalKind; via: 'doc'; label: string; file: string; doc: string }
  | { kind: ArrivalKind; via: 'artifact'; id: string; article?: boolean }
  | { kind: 'board'; via: 'board'; id: string; title: string }
  | { kind: 'drafts'; via: 'drafts' };

/** the states in which a task's review waits for your verdict: its review opens with the session */
export const VERDICT_STATES: ReadonlySet<string> = new Set(['plan_review', 'design_review', 'ship_review']);
