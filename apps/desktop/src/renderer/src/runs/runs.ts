// Run-tree derivations for the run card + dock — extracted from App.tsx (track A2).
// Pure: the replica rows in, display shapes out. The components that render them stay
// in App.tsx until the runs/ UI slice.
import { runElapsed, buildRunTrees, flattenRunTree, type RunTreeOf } from '@neuramesh/shared';
import type { RunUI } from '../bridge/rows-board';

/** the replica row is snake_case; the shared helpers speak the domain shape */
export const runClock = (r: RunUI): string => runElapsed({ startedAt: r.started_at, endedAt: r.ended_at });

/**
 * A run and the tree hanging off it — the fan-out is a foreign key, nothing more.
 *
 * Subagents go unbounded in depth (docs/harness/04), so this is `RunTreeOf<RunUI>` from shared: the
 * previous local version collected DIRECT children only and filtered any row with a parent out of the
 * root list, which meant a GRANDCHILD rendered nowhere at all — orphaned, not flattened. Grouping
 * lives in shared now because it is logic with edge cases (cycles, a parent pruned by retention), and
 * those deserve tests rather than a renderer comment.
 */
export type RunTree = RunTreeOf<RunUI>;

/** group a room's flat run rows into the trees for one surface (a convo thread, or a task) */
export function runTrees(rows: RunUI[], where: { threadId?: string | null; taskId?: string | null }): RunTree[] {
  return buildRunTrees(rows, (r) => {
    if (where.taskId) return r.task_id === where.taskId;
    if (where.threadId) return r.thread_id === where.threadId;
    return !r.thread_id && !r.task_id; // the room feed: runs born in the channel itself
  });
}

/**
 * Read `runs.seat` — `role·model[·@specialist]` — into what the row shows.
 *
 * The seat answers "who is doing this", which used to be the board card's assignee and stopped being
 * so once the orchestrator started owning tasks. `from` is the room specialist whose configuration
 * the leg inherited; when there wasn't one it stays null and the row says the plain role, because
 * implying a specialist that does not exist is worse than admitting a default.
 */
export function parseSeat(seat: string | null): { label: string; from: string | null; model: string } | null {
  if (!seat) return null;
  const [role, model, who] = seat.split('·');
  if (!role || !model) return null;
  const from = who?.startsWith('@') ? who.slice(1) : null;
  return { label: `${from ?? role} · ${shortModel(model)}`, from, model };
}

/** Model ids are long and the seat column is narrow — keep the family, drop the vendor and the date. */
export function shortModel(model: string): string {
  return model
    .replace(/^(claude|anthropic|openai|google)[-/]/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

/**
 * The chips under a card: what the subtree IS, at a glance, even when every leg is folded away.
 *
 * A failed leg is counted rather than hidden — the same discipline the leg-failure path already keeps
 * ("a dead leg is REPORTED, not hidden"), because a tidy card that quietly covered four angles instead
 * of five is worse than one showing the hole.
 */
export function rollupChips(tree: RunTree): string[] {
  const nodes = flattenRunTree(tree).slice(1); // exclude the root itself
  if (!nodes.length) return [];
  const out: string[] = [`${nodes.length} subagent${nodes.length === 1 ? '' : 's'}`];
  const depth = Math.max(...nodes.map((n) => n.depth));
  if (depth > 1) out.push(`depth ${depth}`);
  const bad = nodes.filter((n) => n.run.state === 'failed' || n.run.state === 'stopped').length;
  if (bad) out.push(`${bad} failed`);
  const parked = nodes.filter((n) => n.run.state === 'parked').length;
  if (parked) out.push(`${parked} waiting`);
  return out;
}

/** a wake run is the ghost's twin: while the ghost is up, ONE of them speaks (docs/26). */
export const isWatchableRun = (t: RunTree): boolean => t.run.kind !== 'wake' || t.legs.length > 0;
