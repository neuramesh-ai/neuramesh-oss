// THREADS, GROUPED BY PROJECT — the grouping the Threads tab adds over the time buckets Home used
// to draw (George, 2026-09-08: "threads grouped by projects").
//
// Pure, and generic over the row: it takes anything carrying a `channelId` and a resolver, so it
// never imports from sessions.ts. That file reaches @powersync/react-native at module load, which a
// node test cannot open at all — the same reason going-out-slots.ts sits apart from going-out.tsx.

export interface RowGroup<R> {
  /** stable list key — a project id, or the one sentinel below */
  key: string;
  label: string;
  rows: R[];
}

/** rows whose room belongs to no project, or to one the replica has not synced yet */
export const NO_PROJECT = 'no-project';

/**
 * Group rows by their room's project, in FIRST-APPEARANCE order.
 *
 * The caller hands rows already sorted by recency, so first-appearance puts the project you touched
 * most recently at the top and the dormant ones below. Sorting the groups by name instead would
 * bury today's work under whatever a project happens to be called, which is the opposite of what a
 * session list is for. Rows keep their incoming order inside a group.
 */
export function groupByProject<R extends { channelId: string | null }>(
  rows: readonly R[],
  projectOf: (channelId: string | null) => { id: string; name: string } | null,
): Array<RowGroup<R>> {
  const held = new Map<string, RowGroup<R>>();
  for (const row of rows) {
    const project = projectOf(row.channelId);
    const key = project?.id ?? NO_PROJECT;
    const existing = held.get(key);
    if (existing) existing.rows.push(row);
    else held.set(key, { key, label: project?.name ?? 'No project', rows: [row] });
  }
  // a Map keeps insertion order, which IS first-appearance order
  return [...held.values()];
}
