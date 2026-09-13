// Migrate to Cloud: every sentence a person reads (CLAUDE.md #11, the artboards' words, H1 and H2),
// the door rule, and the byte formatter. No React here, so the copy and the rule are unit tests.
import type { ConnectionCard, MoveStorage } from '../bridge/nm';

export const MOVE_COPY = {
  eyebrow: 'Pro',
  title: (source: string) => `Migrate ${source} to Cloud`,
  into: 'Migrate into',
  projects: 'Projects',
  threads: 'Threads',
  tasks: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
  files: 'Files',
  of: (allocation: string) => `of ${allocation}`,
  agents: 'Agents',
  noAgents: 'none',
  mergeByName: 'merge by name',
  stays: 'Stays here',
  staysLine: 'Keys and sign-ins · files on disk · the local copy, as a backup',
  tooLarge: (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} over 4 MB`,
  move: 'Migrate to Cloud',
  notNow: 'Not now',
  cancel: 'Cancel',
  foot: 'Runs in the background · you can keep working',
  wait: 'Please wait…',
  batch: (seq: number, total: number) => `batch ${seq} of ${total}`,
  written: (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} written`,
  stopped: (seq: number, total: number) => `The migration stopped after batch ${seq - 1} of ${total}. Choose Migrate to Cloud to continue.`,
  refusal: {
    PLAN_LIMIT: (s: MoveStorage | undefined) => (s ? `This plan has ${fmtBytes(Math.max(0, s.allocationBytes - s.usedBytes))} left of ${fmtBytes(s.allocationBytes)}, and the migration needs ${fmtBytes(s.totalBytes)}.` : 'This workspace needs Pro. Get Pro to migrate a workspace into it.'),
    IMPORT_ORDER: (table: string | undefined) => `The migration stopped at ${table ?? 'a table'}. Choose Migrate to Cloud to continue.`,
    NOT_PERMITTED: 'Only the workspace owner can migrate a workspace into it.',
    IMPORT_TOO_LARGE: 'One batch is over 4 MB. Choose Migrate to Cloud to try again.',
    FAILED: (message: string | undefined) => message || 'The migration did not start. Choose Migrate to Cloud to try again.',
  },
  moved: {
    title: 'Migrated',
    sub: (projects: number, threads: number, bytes: string, target: string) => `${projects} ${projects === 1 ? 'project' : 'projects'}, ${threads} ${threads === 1 ? 'thread' : 'threads'}, and ${bytes} are in ${target}. The local copy stays on this Mac as a backup.`,
    open: (target: string) => `Open in ${target}`,
    done: 'Done',
  },
  /** the This Mac card's row once the move ran to the end */
  card: { door: 'Migrate to Cloud', moved: 'Migrated to', open: 'Open' },
} as const;

/** `1.2 GB`, `340 MB`, `12 KB`: one decimal above the unit, none below it */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? Math.round(v) : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export type MoveDoor = 'move' | 'upgrade' | 'none';

/**
 * Which door the This Mac card and the rail's foot show. No local connection, or one that moved
 * already: none (the Moved row speaks instead). A cloud connection with a Pro workspace: the move.
 * Otherwise the Upgrade sheet, because a move into Free is refused before a row is written. `plan`
 * is the plan the shell already knows for the foreground workspace, a fallback for a caller that
 * has no cards yet (the foot).
 */
/** the facts the rule reads: the Settings cards (ConnectionCard) and the foot's summaries (ConnectionSummary) both carry them */
export interface MoveDoorFacts { kind: ConnectionCard['kind']; workspaces: ReadonlyArray<{ plan?: string | null }>; moved?: unknown }

export function moveDoorFor(connections: ReadonlyArray<MoveDoorFacts> | null, plan?: string | null): MoveDoor {
  const local = connections?.find((c) => c.kind === 'local');
  if (!local || local.moved) return 'none';
  const cloud = connections?.find((c) => c.kind === 'cloud');
  if (!cloud) return 'upgrade';
  return cloud.workspaces.some((w) => w.plan === 'cloud') || plan === 'cloud' ? 'move' : 'upgrade';
}
