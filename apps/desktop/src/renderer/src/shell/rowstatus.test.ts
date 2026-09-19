// The ⌘Y overlay's row marks (the thread-status round): the shared status derivation fed from the
// shell's rows, plus the ask pulse. Run from apps/desktop: pnpm exec tsx --test src/renderer/src/shell/rowstatus.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRowMarks } from './rowstatus';
import type { DecisionAllRow, TaskAllRow } from '../bridge/rows-board';
import type { HistoryThreadRow } from '../bridge/rows-rooms';

const T0 = '2026-09-08T10:00:00.000Z';
const T1 = '2026-09-08T10:05:00.000Z';
const T2 = '2026-09-08T10:10:00.000Z';
const task = (o: Partial<TaskAllRow> & { id: string; state: string }): TaskAllRow => ({
  number: 1, title: 't', description: null, kind: null, assignee_kind: null, assignee_id: null,
  offered_agent_id: null, requirements: null, requirements_confirmed: null, definition_of_done: null,
  project_id: 'p', channel_id: 'c', branch: null, repo_id: null, submitted_sha: null, pr_url: null,
  pr_number: null, artifact_count: null, ship_plan: null, parent_task_id: null,
  created_at: T0, updated_at: T0, claimed_at: null, submitted_at: null, approved_at: null,
  accepted_at: null, closed_at: null, channel_slug: 'build', last_human_msg_at: null, ...o,
} as TaskAllRow);
const thread = (o: Partial<HistoryThreadRow> & { id: string }): HistoryThreadRow => ({
  channel_id: 'c', channel_slug: 'build', title: 't', task_id: null, updated_at: T0, last_author_kind: 'agent', last_at: T0, ...o,
});
const row = (o: { threadId: string | null; task: TaskAllRow | null }) => ({ key: 'k', channelId: 'c', channelSlug: 'build', title: 't', snip: '', when: T0, state: o.task?.state ?? null, branch: null, ...o });
const card = (o: Partial<DecisionAllRow> & { id: string }): DecisionAllRow => ({
  channel_id: 'c', task_id: null, message_id: o.id, asker_kind: 'agent', asker_id: 'a', question: 'q?', options: null,
  allow_other: 1, status: 'open', answer: null, created_at: T0, answered_at: null, channel_slug: 'build', task_number: null, ...o,
});

test('a done task needs you; a settle newer than its gate settles it', () => {
  const marks = makeRowMarks({ decisions: [], liveIds: new Set(), threads: [] });
  assert.equal(marks(row({ threadId: null, task: task({ id: 't1', state: 'done' }) })).status, 'needs_you');
  assert.equal(marks(row({ threadId: null, task: task({ id: 't1', state: 'done', settled_at: T1 }) })).status, 'settled');
});

test('an open card lights the ask pulse and needs you; a chat the agent answered is settled', () => {
  const marks = makeRowMarks({ decisions: [card({ id: 'd1', thread_id: 'th1' })], liveIds: new Set(), threads: [thread({ id: 'th1' }), thread({ id: 'th2' })] });
  assert.deepEqual(marks(row({ threadId: 'th1', task: null })), { status: 'needs_you', ask: true, settle: true });
  // an agent-answered chat carries no stamp, so there is nothing for a settle control to move
  assert.deepEqual(marks(row({ threadId: 'th2', task: null })), { status: 'settled', ask: false, settle: false });
});

test('a conversation carries the gates of the units it owns', () => {
  const owned = task({ id: 'u1', state: 'done', origin_thread_id: 'th1' } as Partial<TaskAllRow> & { id: string; state: string });
  const marks = makeRowMarks({ decisions: [], liveIds: new Set(), threads: [thread({ id: 'th1' })], tasks: [owned] });
  assert.equal(marks(row({ threadId: 'th1', task: null })).status, 'needs_you');
});

test('a live run is in progress', () => {
  const marks = makeRowMarks({ decisions: [], liveIds: new Set(['th1']), threads: [thread({ id: 'th1' })] });
  assert.equal(marks(row({ threadId: 'th1', task: null })).status, 'in_progress');
});

test('the settle act rides the marks — the row control and the word come from one input', () => {
  const marks = makeRowMarks({ decisions: [], liveIds: new Set(['th1']), threads: [thread({ id: 'th1' }), thread({ id: 'th2', last_author_kind: 'human', last_at: T0, settled_at: T1 })] });
  // a live run alone: in progress, and no control (a stamp does not gate liveness)
  assert.deepEqual(marks(row({ threadId: 'th1', task: null })), { status: 'in_progress', ask: false, settle: false });
  // a chat you already settled: no reverse control either — unsettle is the toast's undo
  assert.deepEqual(marks(row({ threadId: 'th2', task: null })), { status: 'settled', ask: false, settle: false });
  // a row with no thread (an engineering session) can never settle
  assert.equal(marks(row({ threadId: null, task: task({ id: 't1', state: 'done' }) })).settle, false);
});

test('drafted posts waiting on an owned content unit lift the conversation (release drafts §4.5)', () => {
  // accepted on its own reads settled: it is the DRAFTS that lift the row
  const unit = task({ id: 'u2', number: 1142, state: 'accepted', kind: 'content', origin_thread_id: 'th1' } as Partial<TaskAllRow> & { id: string; state: string });
  const drafts = [
    { task_id: 'u2', created_at: T0, status: 'draft' },
    { task_id: 'u2', created_at: T1, status: 'draft' },
    { task_id: 'u2', created_at: T1, status: 'scheduled' }, // approved already: not waiting
    { task_id: 'elsewhere', created_at: T1, status: 'draft' }, // another unit's, not this conversation's
    { task_id: null, created_at: T1, status: 'draft' }, // a thread-anchored draft rides its own thread
  ];
  const marks = makeRowMarks({ decisions: [], liveIds: new Set(), threads: [thread({ id: 'th1' }), thread({ id: 'th2' })], tasks: [unit], drafts });
  assert.deepEqual(marks(row({ threadId: 'th1', task: null })), { status: 'needs_you', ask: false, settle: true });
  assert.equal(marks(row({ threadId: 'th2', task: null })).status, 'settled');
  // a request for changes after the newest draft hands the ball back to the agent
  const spoke = makeRowMarks({ decisions: [], liveIds: new Set(), threads: [thread({ id: 'th1', last_author_kind: 'human', last_at: T2 })], tasks: [unit], drafts });
  assert.equal(spoke(row({ threadId: 'th1', task: null })).status, 'in_progress');
  // a settle newer than the drafts hides them
  const settled = makeRowMarks({ decisions: [], liveIds: new Set(), threads: [thread({ id: 'th1', settled_at: T2 })], tasks: [unit], drafts });
  assert.deepEqual(settled(row({ threadId: 'th1', task: null })), { status: 'settled', ask: false, settle: false });
  // no drafts handed in (the callers that have none): the rule is inert
  assert.equal(makeRowMarks({ decisions: [], liveIds: new Set(), threads: [thread({ id: 'th1' })], tasks: [unit] })(row({ threadId: 'th1', task: null })).status, 'settled');
});
