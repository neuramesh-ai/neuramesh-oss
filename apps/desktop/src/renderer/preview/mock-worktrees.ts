// The Worktrees destination's fixture (docs/design/worktrees-2026-09 §6 S1): every row kind the
// table can draw, and a clean-up that really removes the row, so a capture can shoot the table
// before and after. The coding thread's row is the same thread mock-fixtures seeds in #dev.
import type { WorktreeRemoveInput, WorktreeRemoveReply, WorktreesPayloadUI, WorktreeTaskRowUI, WorktreeThreadRowUI } from '../src/bridge/rows-infra';
import { CODING_THREAD_ID } from './mock-fixtures';

const ago = (ms: number): number => Date.now() - ms;
const MIN = 60_000;
const DAY = 86_400_000;
const removed = new Set<string>();

const TASKS: WorktreeTaskRowUI[] = [
  { taskNumber: 1046, taskId: 't-1046', title: 'iOS Safari focus-trap release', state: 'in_progress', cls: 'leased', bytes: 812e6, mtimeMs: ago(4 * MIN), repoId: 'r-flowe-app', repoName: 'flowe/app', branch: 'nm/1046-ios-safari-focus-trap', held: true },
  { taskNumber: 1052, taskId: 't-1052', title: 'Calendar lane for drafted posts', state: 'in_progress', cls: 'leased', bytes: 1.1e9, mtimeMs: ago(22 * MIN), repoId: 'r-flowe-app', repoName: 'flowe/app', branch: 'nm/1052-calendar-lane', held: false },
  { taskNumber: 1042, taskId: 't-1042', title: 'Mobile nav: drawer + focus management', state: 'in_review', cls: 'warm', bytes: 640e6, mtimeMs: ago(1 * DAY), repoId: 'r-flowe-app', repoName: 'flowe/app', branch: 'nm/1042-mobile-nav-drawer', held: false },
  { taskNumber: 1031, taskId: 't-1031', title: 'Rename the Board label to Tasks', state: 'accepted', cls: 'dead', bytes: 380e6, mtimeMs: ago(3 * DAY), repoId: 'r-flowe-app', repoName: 'flowe/app', branch: 'nm/1031-rename-board', held: false },
  { taskNumber: 987, taskId: null, title: null, state: null, cls: 'orphan', bytes: 120e6, mtimeMs: ago(12 * DAY), repoId: null, repoName: null, branch: null, held: false },
];
const THREADS: WorktreeThreadRowUI[] = [
  { name: `engineering-u-george-r-flowe-app-${CODING_THREAD_ID}`, threadId: CODING_THREAD_ID, channelId: 'c-dev', title: 'Fix the sync watch dropping thread replies', cls: 'waits', bytes: 790e6, mtimeMs: ago(9 * MIN), repoName: 'flowe/app', branch: 'nm/engineering/u-george/th-coding-sync', dirty: 2, held: true },
  { name: 'engineering-u-george-r-flowe-app-th-reconnect', threadId: 'th-reconnect', channelId: 'c-dev', title: 'Explain the reconnect path in sync.ts', cls: 'idle', bytes: 410e6, mtimeMs: ago(2 * DAY), repoName: 'flowe/app', branch: 'nm/engineering/u-george/th-reconnect', dirty: 0, held: false },
  { name: 'engineering-u-george-r-flowe-app-th-old', threadId: null, channelId: null, title: null, cls: 'orphan', bytes: 96e6, mtimeMs: ago(20 * DAY), repoName: null, branch: 'nm/engineering/u-george/th-old', dirty: 0, held: false },
];

export function worktreesFixture(): WorktreesPayloadUI {
  const tasks = TASKS.filter((t) => !removed.has(`nm-${t.taskNumber}`));
  const threads = THREADS.filter((t) => !removed.has(t.name));
  const settled = tasks.filter((t) => t.cls === 'dead' || t.cls === 'orphan');
  return {
    at: new Date().toISOString(), machine: 'george’s MacBook Pro', tasks, threads,
    fleet: [
      { tool: 'Codex', path: '~/.codex/worktrees', count: 3, bytes: 1.8e9, oldestMs: ago(30 * DAY) },
      { tool: 'Claude Code', path: '~/flowe/app/.claude/worktrees', count: 2, bytes: 940e6, oldestMs: ago(46 * DAY) },
    ],
    settled: { count: settled.length, bytes: settled.reduce((n, t) => n + t.bytes, 0) },
  };
}

export function worktreeRemoveMock(input: WorktreeRemoveInput): WorktreeRemoveReply {
  const before = worktreesFixture();
  let freedBytes = 0;
  if (input.kind === 'settled') {
    for (const t of before.tasks.filter((x) => x.cls === 'dead' || x.cls === 'orphan')) { removed.add(`nm-${t.taskNumber}`); freedBytes += t.bytes; }
  } else if (input.kind === 'task') {
    const row = before.tasks.find((t) => t.taskNumber === input.taskNumber);
    if (!row) return { ok: false, code: 'NOT_FOUND', payload: before };
    if (row.held && !input.force) return { ok: false, code: 'WORKTREE_BUSY', payload: before };
    removed.add(`nm-${row.taskNumber}`); freedBytes = row.bytes;
  } else {
    const row = before.threads.find((t) => t.name === input.name);
    if (!row) return { ok: false, code: 'NOT_FOUND', payload: before };
    if (row.held && !input.force) return { ok: false, code: 'WORKTREE_BUSY', payload: before };
    removed.add(row.name); freedBytes = row.bytes;
  }
  return { ok: true, freedBytes, notes: ['worktree'], payload: worktreesFixture() };
}
