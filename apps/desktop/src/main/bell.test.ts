// The bell's queue and its in-flight lane (the shell-simplification round, 2026-08-16).
// Run from apps/desktop: pnpm exec tsx --test src/main/bell.test.ts
//
// Home's needs-you derivation moved onto chrome. It is tested here because moving a derivation is
// exactly when its two hard-won rules get quietly dropped — the finished-SUBTASK trap (a card no
// click could ever clear, one per subtask, forever) and the answered gate that must leave the
// queue at once without vanishing silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bellFlight, bellKind, bellQueue } from '../renderer/src/shell/bell';
import type { DecisionAllRow, RunUI, TaskAllRow } from '../renderer/src/bridge/rows-board';
import type { AgentRow } from '../renderer/src/bridge/rows-crew';
import type { HomeConvoRow } from '../renderer/src/bridge/rows-rooms';

const T0 = Date.parse('2026-08-16T12:00:00.000Z');
const at = (minsAgo: number) => new Date(T0 - minsAgo * 60_000).toISOString();

const task = (o: Partial<TaskAllRow> & { id: string; state: string }): TaskAllRow => ({
  number: 1, title: 't', description: null, kind: null, assignee_kind: null, assignee_id: null,
  offered_agent_id: null, requirements: null, requirements_confirmed: null, definition_of_done: null,
  project_id: 'p', channel_id: 'c', branch: null, repo_id: null, submitted_sha: null, pr_url: null,
  pr_number: null, artifact_count: null, ship_plan: null, parent_task_id: null,
  created_at: at(600), updated_at: at(10), claimed_at: null, submitted_at: null, approved_at: null,
  accepted_at: null, closed_at: null, channel_slug: 'build', last_human_msg_at: null, ...o,
});
const dec = (o: Partial<DecisionAllRow> & { id: string }): DecisionAllRow => ({
  channel_id: 'c', task_id: null, message_id: o.id, asker_kind: 'agent', asker_id: 'a-rex',
  question: 'q?', options: null, allow_other: 1, status: 'open', answer: null,
  created_at: at(60), answered_at: null, channel_slug: 'build', task_number: null, ...o,
});
const AGENTS: AgentRow[] = [
  { id: 'a-rex', name: 'rex', role: 'orchestrator', model: 'm', status: 'idle', channel_ids: 'c' } as AgentRow,
  { id: 'a-dev', name: 'plume', role: 'developer', model: 'm', status: 'idle', channel_ids: 'c' } as AgentRow,
];

test('a reviewer-approved task queues as an accept, newest first', () => {
  const q = bellQueue({
    tasks: [task({ id: 'old', state: 'done', number: 1, updated_at: at(90) }), task({ id: 'new', state: 'done', number: 2, updated_at: at(2) })],
    decisions: [], agents: AGENTS,
  });
  assert.deepEqual(q.rows.map((r) => r.id), ['new', 'old']);
  assert.equal(q.count, 2);
});

test('THE FINISHED-SUBTASK TRAP: a subtask never queues — its gates belong to its parent', () => {
  // shipped once: `finish` put a subtask in `done`, the queue offered an Accept, and the server is
  // required to refuse it — one uncleaable card per subtask, forever
  const q = bellQueue({
    tasks: [task({ id: 'sub', state: 'done', parent_task_id: 'parent' }), task({ id: 'parent', state: 'in_progress' })],
    decisions: [], agents: AGENTS,
  });
  assert.equal(q.rows.length, 0);
  assert.equal(q.count, 0);
});

test('a gate you have replied to leaves AT ONCE — and lands in flight, never silently dropped', () => {
  const replied = task({ id: 'p1', state: 'plan_review', updated_at: at(120), last_human_msg_at: at(1) });
  const q = bellQueue({ tasks: [replied], decisions: [], agents: AGENTS });
  assert.equal(q.count, 0, 'answered gates are waiting on an AGENT now');
  const f = bellFlight({ tasks: [replied], convos: [], runs: [], now: T0 });
  assert.deepEqual(f.map((r) => r.kind), ['task'], 'and it rides the in-flight lane instead');
});

test('a DONE setup task never queues (its state has no accept), an OPEN one always does', () => {
  const open = bellQueue({ tasks: [task({ id: 's', state: 'todo', kind: 'setup' })], decisions: [], agents: AGENTS });
  assert.deepEqual(open.rows.map((r) => r.id), ['s']);
  const done = bellQueue({ tasks: [task({ id: 's', state: 'done', kind: 'setup' })], decisions: [], agents: AGENTS });
  assert.equal(done.rows.length, 0, 'SETUP_TASK_TRANSITIONS has no accept — the button would be refused forever');
});

test('one card per multi-room ask: N decision rows sharing a message_id group into one', () => {
  const q = bellQueue({
    tasks: [],
    decisions: [
      dec({ id: 'd1', message_id: 'm', created_at: at(30) }),
      dec({ id: 'd2', message_id: 'm', created_at: at(29) }),
      dec({ id: 'd3', message_id: 'other', created_at: at(5) }),
    ],
    agents: AGENTS,
  });
  const groups = q.rows.filter((r) => r.kind === 'decision');
  assert.equal(groups.length, 2, 'two cards, not three rows');
  assert.equal((groups[0] as { g: DecisionAllRow[] }).g.length, 2);
  assert.equal(q.count, 3, '…but the COUNT is still every ask waiting');
});

test('decisions are longest-waiting first — an unanswered question only gets older', () => {
  const q = bellQueue({
    tasks: [],
    decisions: [dec({ id: 'newer', message_id: 'a', created_at: at(5) }), dec({ id: 'older', message_id: 'b', created_at: at(500) })],
    agents: AGENTS,
  });
  assert.deepEqual(q.rows.map((r) => r.id), ['older', 'newer']);
});

test('order is accepts → decisions → the rest', () => {
  const q = bellQueue({
    tasks: [task({ id: 'blk', state: 'blocked' }), task({ id: 'acc', state: 'done' }), task({ id: 'plan', state: 'plan_review' })],
    decisions: [dec({ id: 'd' })],
    agents: AGENTS,
  });
  assert.deepEqual(q.rows.map((r) => r.id), ['acc', 'd', 'plan', 'blk']);
});

test('a settled card leaves the COUNT at once and the LIST after its collapse', () => {
  const tasks = [task({ id: 'a', state: 'done' }), task({ id: 'b', state: 'done' })];
  const mid = bellQueue({ tasks, decisions: [], agents: AGENTS, gone: new Set(['a']), leaving: new Set(['a']) });
  assert.equal(mid.count, 1, 'out of the count immediately');
  assert.deepEqual(mid.rows.map((r) => r.id), ['a', 'b'], '…but still drawn while it collapses');
  const after = bellQueue({ tasks, decisions: [], agents: AGENTS, gone: new Set(['a']), leaving: new Set() });
  assert.deepEqual(after.rows.map((r) => r.id), ['b']);
  // and it self-heals: with the sets cleared, a row the server did not actually move comes back
  assert.equal(bellQueue({ tasks, decisions: [], agents: AGENTS }).count, 2);
});

test('an unstaffed room queues its todo — the board says todo and nothing can move', () => {
  const orchOnly: AgentRow[] = [AGENTS[0]!];
  const q = bellQueue({ tasks: [task({ id: 'u', state: 'todo' })], decisions: [], agents: orchOnly });
  assert.deepEqual(q.rows.map((r) => r.id), ['u']);
  // …and a staffed one does not
  assert.equal(bellQueue({ tasks: [task({ id: 'u', state: 'todo' })], decisions: [], agents: AGENTS }).count, 0);
});

test('the row chip names the kind, never a bare FSM state', () => {
  assert.equal(bellKind(task({ id: 'x', state: 'todo', kind: 'setup' })), 'setup');
  assert.equal(bellKind(task({ id: 'x', state: 'done' })), 'ready');
  assert.equal(bellKind(task({ id: 'x', state: 'blocked' })), 'blocked');
  assert.equal(bellKind(task({ id: 'x', state: 'plan_review' })), 'plan review');
});

// ── the in-flight lane ────────────────────────────────────────────────────────────────────────

const run = (o: Partial<RunUI> & { id: string }): RunUI => ({
  channel_id: 'c', thread_id: null, task_id: null, agent_id: 'a-dev', parent_run_id: null,
  kind: 'work', title: 'r', state: 'running', step: null, seat: null, done: 0, total: 0,
  summary: null, started_at: at(5), ended_at: null, updated_at: at(1), ...o,
} as RunUI);
const convo = (o: Partial<HomeConvoRow> & { id: string }): HomeConvoRow => ({
  channel_id: 'c', channel_slug: 'build', title: 'chat', task_id: null, updated_at: at(30), ...o,
});

test('a task with an open run is listed ONCE — by the run, which carries the live step', () => {
  const f = bellFlight({
    tasks: [task({ id: 't1', state: 'in_progress' })],
    convos: [],
    runs: [run({ id: 'r1', task_id: 't1', step: 'patching' })],
    now: T0,
  });
  assert.deepEqual(f.map((r) => r.kind), ['run']);
});

test('legs and wakes stay out — a leg is detail for the card, not a workspace row', () => {
  const f = bellFlight({
    tasks: [], convos: [],
    runs: [run({ id: 'leg', parent_run_id: 'r1' }), run({ id: 'wake', kind: 'wake' }), run({ id: 'done', state: 'done' }), run({ id: 'ok' })],
    now: T0,
  });
  assert.deepEqual(f.map((r) => (r.kind === 'run' ? r.r.id : r.kind)), ['ok']);
});

test('an OPEN setup task is never in flight — no agent moves it, and it is already queued', () => {
  const setup = task({ id: 's', state: 'in_progress', kind: 'setup' });
  assert.equal(bellFlight({ tasks: [setup], convos: [], runs: [], now: T0 }).length, 0);
  assert.equal(bellQueue({ tasks: [setup], decisions: [], agents: AGENTS }).count, 1, 'it queues instead — never both');
});

test('a chat older than a day drops out; a task-bearing thread never enters', () => {
  const f = bellFlight({
    tasks: [], runs: [], now: T0,
    convos: [convo({ id: 'fresh' }), convo({ id: 'stale', updated_at: at(60 * 30) }), convo({ id: 'istask', task_id: 't' })],
  });
  assert.deepEqual(f.map((r) => (r.kind === 'convo' ? r.c.id : r.kind)), ['fresh']);
});

test('subtasks stay out of the lane too — they ride their parent’s card', () => {
  const f = bellFlight({ tasks: [task({ id: 'sub', state: 'in_progress', parent_task_id: 'p' })], convos: [], runs: [], now: T0 });
  assert.equal(f.length, 0);
});

// ── SETTLE (0137, the thread-status round) ────────────────────────────────────────────────────
test('a settled gate leaves the queue; the task moving again brings it back', () => {
  const settled = task({ id: 'd1', state: 'done', number: 7, updated_at: at(30), thread_id: 'th-d1', settled_at: at(10) });
  const q = bellQueue({ tasks: [settled], decisions: [], agents: AGENTS });
  assert.equal(q.count, 0, 'a settle newer than the gate hides the row');
  assert.equal(q.rows.length, 0);
  // the task moved after the settle (a new gate): the stamp is older than the gate, so it needs you again
  const moved = { ...settled, updated_at: at(2) };
  const q2 = bellQueue({ tasks: [moved], decisions: [], agents: AGENTS });
  assert.equal(q2.rows.length, 1);
});

test('a card under a settled conversation leaves; one asked after the settle stays', () => {
  const old = dec({ id: 'c-old', created_at: at(60), thread_id: 'th-1', thread_settled_at: at(30) });
  const fresh = dec({ id: 'c-new', created_at: at(5), thread_id: 'th-1', thread_settled_at: at(30) });
  const q = bellQueue({ tasks: [], decisions: [old, fresh], agents: AGENTS });
  assert.deepEqual(q.rows.map((r) => r.id), ['c-new']);
  assert.equal(q.count, 1);
});
