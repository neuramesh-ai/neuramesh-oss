// The rail's CONNECTION BANDS — pure, beside navtree.ts (which sits at the size bar). Tested from
// src/main/navtree.test.ts.
import type { NavTreeRowMeta } from './navtree';
// ── THE CONNECTION BANDS (U3b, the source-release round, 2026-09-12 — artboards B0 to B2) ────
// The desktop can hold two backends at once: the local stack on this Mac and the hosted cloud
// (main/connections.ts). The rail lists both, under two kickers — LOCAL and CLOUD — in the
// `.navsect` voice. Three rules, each a test above this file's suite:
//  · **only when two.** One connection draws no band and the rail is today's rail, to the pixel;
//  · **the head stays one control.** RECENTS · PROJECTS sits above both bands and applies inside
//    each — a band holds the mode's rows flat, or its folders, never a third shape;
//  · **a fold never silences an ask.** A folded band keeps its count, its ask dot and its live
//    pulse (the 2026-08-16 nesting rule ④, applied to connections).

export type NavConnectionKind = 'local' | 'cloud' | 'custom';

/** what a rail row carries about the backend it came from — the union watch tags every row, and the
 *  bands hook marks a row on a connection the shell does NOT stand in `foreign` (no selection, no
 *  hover controls: a rename there would reach the wrong server) */
export interface NavConnTag { connectionId?: string; connectionKind?: NavConnectionKind; foreign?: boolean }

/** a connection as the rail knows it (bridge `ConnectionSummary`, trimmed to what the bands read) */
export interface NavConnection {
  id: string;
  kind: NavConnectionKind;
  /** a custom server's host — its band's name */
  host?: string | null;
  /** the workspace the connection stands in — what a swap onto one of its rows lands in */
  workspaceId?: string | null;
}

export interface NavBand<R> {
  id: string;
  kind: NavConnectionKind;
  /** `Local` · `Cloud` · a custom server's host */
  name: string;
  /** the band's rows, in the order they arrived — EMPTY while folded */
  rows: R[];
  /** every row the band holds, shown or not — the folded band's count */
  count: number;
  hasAsk: boolean;
  live: boolean;
  folded: boolean;
  /** the band the shell stands in — its selected row is THE selected row */
  on: boolean;
}

/** the band's word: the two products have names, a server someone runs has a host */
export function navBandName(c: Pick<NavConnection, 'kind' | 'host'>): string {
  if (c.kind === 'local') return 'Local';
  if (c.kind === 'cloud') return 'Cloud';
  return c.host?.trim() || 'Server';
}

/** local above cloud above the rest, whatever order the registry keeps them in — the artboards' order */
const BAND_RANK: Record<NavConnectionKind, number> = { local: 0, cloud: 1, custom: 2 };
export function navConnectionOrder(a: NavConnection, b: NavConnection): number {
  return BAND_RANK[a.kind] - BAND_RANK[b.kind] || navBandName(a).localeCompare(navBandName(b));
}

/**
 * Group the rail's rows by connection. `null` with fewer than two connections: the caller draws
 * the rail exactly as before. A row with no tag is the foreground's (an engineering session lives
 * on this Mac, not on a backend). Ask and live are computed over ALL of a band's rows, folded or
 * not, so the kicker can wear them while the rows are away.
 */
export function navBands<R extends NavTreeRowMeta & NavConnTag>(opts: {
  rows: R[];
  connections: NavConnection[];
  foregroundId: string;
  askKeys: Set<string>;
  liveKeys: Set<string>;
  /** connection ids the human folded (persisted beside the folders' fold) */
  folded: Set<string>;
}): Array<NavBand<R>> | null {
  if (opts.connections.length < 2) return null;
  const ordered = opts.connections.slice().sort(navConnectionOrder);
  const known = new Set(ordered.map((c) => c.id));
  const byConn = new Map<string, R[]>(ordered.map((c) => [c.id, []]));
  for (const r of opts.rows) {
    const id = r.connectionId && known.has(r.connectionId) ? r.connectionId : opts.foregroundId;
    byConn.get(id)?.push(r);
  }
  return ordered.map((c) => {
    const mine = byConn.get(c.id) ?? [];
    const folded = opts.folded.has(c.id);
    return {
      id: c.id,
      kind: c.kind,
      name: navBandName(c),
      rows: folded ? [] : mine,
      count: mine.length,
      hasAsk: mine.some((r) => opts.askKeys.has(r.key)),
      live: mine.some((r) => opts.liveKeys.has(r.key)),
      folded,
      on: c.id === opts.foregroundId,
    };
  });
}

/**
 * What opening a row on ANOTHER connection asks main for: `setForeground(connectionId, workspaceId)`
 * (main/sync.ts). Null for a row already on the foreground, an untagged row, or a tag the
 * registry no longer knows — those open as today, nothing swaps.
 */
export function foregroundSwapFor(row: NavTreeRowMeta & NavConnTag, foregroundId: string, connections: NavConnection[]): { connectionId: string; workspaceId: string | null } | null {
  if (!row.connectionId || row.connectionId === foregroundId) return null;
  const c = connections.find((x) => x.id === row.connectionId);
  if (!c) return null;
  return { connectionId: c.id, workspaceId: c.workspaceId ?? null };
}
