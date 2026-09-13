// THE RAIL'S UNION (U3b, the source-release round — review F2: "the rail unions").
//
// The desktop holds several connections at once (connections.ts) and the shell stands in one.
// The foreground's rows already stream to the renderer through the four workspace-wide watches
// a dozen surfaces read (history-all · tasks-all · open-runs · decisions-all). This is the lane
// for every OTHER live connection: one subscription, every slice a rail row is built from, each
// row tagged `{ connectionId, connectionKind }`, re-emitted when any connection's rows change and
// when a connection arrives or leaves. With one connection it carries nothing, and the rail is
// today's rail by construction.
//
// Pure: no electron, no PowerSync. The sources are injected, so the union is a unit test
// (rail-rows.test.ts) and the IPC handler (watch-rail.ts) is six lines of wiring.
import type { ConnectionKind } from '../../connections';

/** the six row-sets a rail row and its band derive from — the SAME queries the foreground's watches run */
export const RAIL_QUERIES = ['threads', 'tasks', 'runs', 'decisions', 'channels', 'projects', 'agents'] as const;
export type RailQuery = (typeof RAIL_QUERIES)[number];

export interface RailSource {
  id: string;
  kind: ConnectionKind;
  /** start a live query; `onRows` fires with every result until the signal aborts */
  watch: (q: RailQuery, onRows: (rows: Array<Record<string, unknown>>) => void, signal: AbortSignal) => void;
}

export type RailTag = { connectionId: string; connectionKind: ConnectionKind };
export type RailRowsPayload = Record<RailQuery, Array<Record<string, unknown> & RailTag>>;

interface Slice { ac: AbortController; kind: ConnectionKind; data: Partial<Record<RailQuery, Array<Record<string, unknown>>>> }

export function railRowsUnion(opts: { sources: () => RailSource[]; emit: (p: RailRowsPayload) => void }): { refresh: () => void; abort: () => void } {
  const slices = new Map<string, Slice>();
  // results from several queries land in the same turn (the first answer of every watch on
  // attach); one push per turn, not one per query
  let scheduled = false;
  const emit = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      const out = Object.fromEntries(RAIL_QUERIES.map((q) => [q, []])) as unknown as RailRowsPayload;
      for (const [id, s] of slices) {
        for (const q of RAIL_QUERIES) {
          for (const r of s.data[q] ?? []) out[q].push({ ...r, connectionId: id, connectionKind: s.kind });
        }
      }
      opts.emit(out);
    });
  };
  const refresh = () => {
    const now = opts.sources();
    const ids = new Set(now.map((s) => s.id));
    let changed = false;
    for (const [id, s] of slices) {
      if (ids.has(id)) continue;
      s.ac.abort();
      slices.delete(id);
      changed = true;
    }
    for (const src of now) {
      if (slices.has(src.id)) continue;
      const slice: Slice = { ac: new AbortController(), kind: src.kind, data: {} };
      slices.set(src.id, slice);
      for (const q of RAIL_QUERIES) {
        src.watch(q, (rows) => { slice.data[q] = rows; emit(); }, slice.ac.signal);
      }
    }
    if (changed) emit();
  };
  const abort = () => {
    for (const s of slices.values()) s.ac.abort();
    slices.clear();
  };
  return { refresh, abort };
}
