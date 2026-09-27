// The Worktrees destination's row policy (docs/design/worktrees-2026-09 §3 to §5). Pure, like
// berths.ts: it never sees a path and never touches a disk. classifyBerth owns a TASK row's class
// (docs/40). This module owns the rest: a coding thread's class, the engineering worktree names
// (one spelling, shared with the writer in relay/engineering-workspace.ts), the bulk button's set
// and the one refusal a removal can meet.
import { decideSweep, type BerthEntry } from './berths';

/** what the runtime does in a coding thread's worktree, read from its code_sessions row */
export type ThreadWorktreeClass = 'working' | 'waits' | 'idle' | 'orphan';

export function classifyThreadWorktree(session: { state: string | null } | null, threadExists: boolean): ThreadWorktreeClass {
  if (!threadExists) return 'orphan';
  const state = session?.state ?? null;
  if (state === 'streaming') return 'working';
  if (state === 'awaiting_approval') return 'waits';
  return 'idle';
}

/** the one path-segment rule the engineering names use: ids as they are, anything else becomes a dash */
export const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
export const ENGINEERING_WORKTREE_PREFIX = 'engineering-';
export const ENGINEERING_BRANCH_PREFIX = 'nm/engineering/';

export function engineeringWorktreeName(actorId: string, repoId: string, threadId: string): string {
  return `${ENGINEERING_WORKTREE_PREFIX}${safeSegment(actorId)}-${safeSegment(repoId)}-${safeSegment(threadId)}`;
}
export function engineeringBranchName(actorId: string, threadId: string): string {
  return `${ENGINEERING_BRANCH_PREFIX}${safeSegment(actorId)}/${safeSegment(threadId)}`;
}

/** The thread a worktree directory belongs to. The three segments all carry dashes, so the name
 *  is read from its END: it belongs to the thread whose safe id it ends with. null = no thread. */
export function threadForWorktreeName(name: string, threadIds: Iterable<string>): string | null {
  if (!name.startsWith(ENGINEERING_WORKTREE_PREFIX)) return null;
  let best: string | null = null;
  for (const id of threadIds) {
    const safe = safeSegment(id);
    if (safe && name.endsWith(`-${safe}`) && (best === null || safe.length > safeSegment(best).length)) best = id;
  }
  return best;
}

/** the bulk button (`Clean up settled`): the sweeper's own REMOVE verdicts on the task berths,
 *  settled and no-task rows only. An eviction under budget pressure is the footprint's business. */
export function settledBerths(berths: BerthEntry[]): { taskNumbers: number[]; bytes: number } {
  const removes = decideSweep(berths, [], []).filter((a) => a.kind === 'remove-berth');
  const taskNumbers = removes.map((a) => a.taskNumber);
  const bytes = berths.filter((b) => taskNumbers.includes(b.taskNumber)).reduce((n, b) => n + b.bytes, 0);
  return { taskNumbers, bytes };
}

export type RemovalVerdict = { ok: true } | { ok: false; code: 'WORKTREE_BUSY' };

/** A held worktree (a shell or a runtime stands in it) is refused, unless the person forced it.
 *  Only the active-row confirm sets force, out loud (plan §3.3). */
export function removalVerdict(o: { held: boolean; force: boolean }): RemovalVerdict {
  return o.held && !o.force ? { ok: false, code: 'WORKTREE_BUSY' } : { ok: true };
}
