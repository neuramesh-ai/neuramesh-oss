// The room surface lens (Conversations · Board everywhere, Calendar · Library only where a
// marketing HQ is set up) and the session list behind it: its rows, their date grouping, and the
// pinned room brief. Run from apps/desktop:
//   pnpm exec tsx --test src/main/room-tabs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyRows,
  resolveRoomSurface,
  roomBrief,
  roomBriefs,
  roomTabsFor,
  sessionGroups,
  type HistoryRow,
  type HistoryTask,
  type RoomMessage,
  briefPretty,
  briefPrettyFull,
  briefSummary,
} from '../renderer/src/room-tabs';

const task = (over: Partial<HistoryTask> & { id: string; number: number }): HistoryTask => ({
  title: `task ${over.number}`,
  description: null,
  channel_id: 'c-dev',
  parent_task_id: null,
  updated_at: '2026-07-20T10:00:00Z',
  ...over,
});

test('a plain room has ONE surface — Board and Routines left the strip for the nav head scope', () => {
  // 2026-08-03, George: "why do we have a conversation and a board tab, we should only have
  // conversation… board is already on the left menu now". Board and Automations read the nav
  // head's channel scope, so a per-room copy of either is a second door disagreeing about scope.
  assert.deepEqual(roomTabsFor(null, false).map((t) => t.id), ['feed']);
  assert.deepEqual(roomTabsFor('build', false).map((t) => t.id), ['feed']);
});

test('the feed tab reads "Conversations" while its id stays "feed" for persisted roomViews', () => {
  const [first] = roomTabsFor('build', false);
  assert.equal(first!.label, 'Conversations');
  assert.equal(first!.id, 'feed'); // a renamed id would strand every stored roomView
  assert.deepEqual(roomTabsFor('marketing', true).map((t) => t.label), ['Conversations', 'Calendar', 'Library']);
  assert.equal(resolveRoomSurface('feed', roomTabsFor('build', false)), 'feed');
});

test('a set-up marketing HQ appends Calendar · Library — the only rooms with a real strip', () => {
  assert.deepEqual(roomTabsFor('marketing', true).map((t) => t.id), ['feed', 'calendar', 'library']);
});

test('a marketing room without its profile keeps the single surface', () => {
  // the setup card still owns that room — its calendar and library have nothing to show yet
  assert.deepEqual(roomTabsFor('marketing', false).map((t) => t.id), ['feed']);
});

test('a surface the room does not offer falls back to the feed', () => {
  const build = roomTabsFor('build', false);
  assert.equal(resolveRoomSurface('calendar', build), 'feed');
  assert.equal(resolveRoomSurface('library', roomTabsFor('marketing', true)), 'library');
});

test('a roomView of a RETIRED surface lands on the feed, not nothing', () => {
  // history (v0.69), then board + routines (2026-08-03) — each left the strip while staying in
  // the union precisely so an in-flight value resolves instead of rendering an empty surface.
  for (const stale of ['history', 'board', 'routines'] as const) {
    assert.equal(resolveRoomSurface(stale, roomTabsFor('build', false)), 'feed');
    assert.equal(resolveRoomSurface(stale, roomTabsFor('marketing', true)), 'feed');
  }
});

test('history lists threads newest first and folds a task-linked thread onto its task', () => {
  const t1 = task({ id: 't-1', number: 101, title: 'mobile nav focus trap' });
  const rows = historyRows({
    threads: [
      { id: 'th-1', task_id: 't-1', title: 'Fix the mobile nav', last_body: 'pushed the branch', updated_at: '2026-07-21T09:00:00Z' },
      { id: 'th-2', task_id: null, title: 'Standup notes', last_body: 'all green', updated_at: '2026-07-22T09:00:00Z' },
    ],
    tasks: [t1],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
  });
  assert.deepEqual(rows.map((r) => r.key), ['th:th-2', 'th:th-1']);
  assert.equal(rows[1]!.task, t1); // the row opens the task, not the thread
  assert.equal(rows[0]!.task, null);
});

test('a task that never grew a thread still appears, once', () => {
  const linked = task({ id: 't-1', number: 101 });
  const bare = task({ id: 't-2', number: 102, title: 'reconcile the pricing figure', updated_at: '2026-07-23T09:00:00Z' });
  const rows = historyRows({
    threads: [{ id: 'th-1', task_id: 't-1', title: 'Fix it', last_body: '', updated_at: '2026-07-21T09:00:00Z' }],
    tasks: [linked, bare],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
  });
  assert.deepEqual(rows.map((r) => r.key), ['tk:t-2', 'th:th-1']);
  assert.equal(rows[0]!.title, '#102 · reconcile the pricing figure');
  assert.equal(rows[0]!.snip, '#dev'); // no description → the row names its room
});

test('another room’s tasks never leak into this room’s history', () => {
  const rows = historyRows({
    threads: [],
    tasks: [task({ id: 't-9', number: 900, channel_id: 'c-marketing' })],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
  });
  assert.deepEqual(rows, []);
});

test('subtasks stay folded under their parent, out of the history list', () => {
  const rows = historyRows({
    threads: [],
    tasks: [task({ id: 't-sub', number: 103, parent_task_id: 't-1' })],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
  });
  assert.deepEqual(rows, []);
});

test('search matches title and snippet, case-insensitively', () => {
  const threads = [
    { id: 'th-1', task_id: null, title: 'Weekly Tweet Drafts', last_body: 'six days queued', updated_at: '2026-07-22T09:00:00Z' },
    { id: 'th-2', task_id: null, title: 'Standup', last_body: 'TWEET thread shipped', updated_at: '2026-07-21T09:00:00Z' },
    { id: 'th-3', task_id: null, title: 'Roadmap', last_body: 'q4 planning', updated_at: '2026-07-20T09:00:00Z' },
  ];
  const base = { threads, tasks: [] as HistoryTask[], channelId: 'c-dev', channelSlug: 'dev' };
  assert.deepEqual(historyRows({ ...base, query: 'tweet' }).map((r) => r.key), ['th:th-1', 'th:th-2']);
  assert.deepEqual(historyRows({ ...base, query: '  ' }).map((r) => r.key), ['th:th-1', 'th:th-2', 'th:th-3']);
  assert.deepEqual(historyRows({ ...base, query: 'nothing here' }), []);
});

test('the list is capped, and the cap keeps the newest', () => {
  const threads = Array.from({ length: 250 }, (_, i) => ({
    id: `th-${i}`, task_id: null, title: `thread ${i}`, last_body: '',
    updated_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  }));
  const rows = historyRows({ threads, tasks: [], channelId: 'c-dev', channelSlug: 'dev', query: '' });
  assert.equal(rows.length, 200);
  assert.equal(rows[0]!.key, 'th:th-249');
  assert.equal(historyRows({ threads, tasks: [], channelId: 'c-dev', channelSlug: 'dev', query: '', limit: 5 }).length, 5);
});

// --- workspace-wide history (v0.69): what Home's rail and the overlay show ---

test('channelId null spans every room and each row names its own', () => {
  const a = task({ id: 't-a', number: 1, title: 'nav focus trap', channel_id: 'c-build', channel_slug: 'build' });
  const b = task({ id: 't-b', number: 2, title: 'four X posts', channel_id: 'c-mkt', channel_slug: 'marketing' });
  const rows = historyRows({
    threads: [
      { id: 'th-1', task_id: null, title: 'Weekly review', last_body: 'promoted', updated_at: '2026-07-29T10:00:00Z', channel_id: 'c-build', channel_slug: 'build' },
      { id: 'th-2', task_id: 't-b', title: 'Posts thread', last_body: 'drafted', updated_at: '2026-07-29T11:00:00Z', channel_id: 'c-mkt', channel_slug: 'marketing' },
    ],
    tasks: [a, b],
    channelId: null,
    channelSlug: '',
    query: '',
  });
  assert.deepEqual(rows.map((r) => r.channelSlug), ['marketing', 'build', 'build']);
  // the task-linked thread still folds onto its task, across channels
  assert.equal(rows[0]!.task?.id, 't-b');
  // …and the bare task from the OTHER room still appears
  assert.ok(rows.some((r) => r.key === 'tk:t-a'));
});

test('a scoped list ignores other rooms’ threads even when the watch carries them', () => {
  const a = task({ id: 't-a', number: 1, title: 'nav focus trap', channel_id: 'c-build', channel_slug: 'build' });
  const rows = historyRows({
    threads: [
      { id: 'th-1', task_id: null, title: 'Build chat', last_body: '', updated_at: '2026-07-29T10:00:00Z', channel_id: 'c-build', channel_slug: 'build' },
      { id: 'th-2', task_id: null, title: 'Marketing chat', last_body: '', updated_at: '2026-07-29T11:00:00Z', channel_id: 'c-mkt', channel_slug: 'marketing' },
    ],
    tasks: [a],
    channelId: 'c-build',
    channelSlug: 'build',
    query: '',
  });
  assert.deepEqual(rows.map((r) => r.title), ['Build chat', '#1 · nav focus trap']);
});

test('the room name is searchable, so "marketing" finds that room’s threads from Home', () => {
  const rows = historyRows({
    threads: [
      { id: 'th-1', task_id: null, title: 'Weekly review', last_body: '', updated_at: '2026-07-29T10:00:00Z', channel_id: 'c-build', channel_slug: 'build' },
      { id: 'th-2', task_id: null, title: 'Posts thread', last_body: '', updated_at: '2026-07-29T11:00:00Z', channel_id: 'c-mkt', channel_slug: 'marketing' },
    ],
    tasks: [],
    channelId: null,
    channelSlug: '',
    query: 'marketing',
  });
  assert.deepEqual(rows.map((r) => r.key), ['th:th-2']);
});

// --- a session's state dial: a task row wears its FSM state, a chat row doesn't ---

test('a task row carries its FSM state and a chat row carries none', () => {
  const linked = task({ id: 't-1', number: 101, state: 'in_progress' });
  const bare = task({ id: 't-2', number: 102, state: 'in_review', updated_at: '2026-07-23T09:00:00Z' });
  const rows = historyRows({
    threads: [
      { id: 'th-1', task_id: 't-1', title: 'Fix the nav', last_body: '', updated_at: '2026-07-21T09:00:00Z' },
      { id: 'th-2', task_id: null, title: 'Standup', last_body: '', updated_at: '2026-07-22T09:00:00Z' },
    ],
    tasks: [linked, bare],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
  });
  const state = new Map(rows.map((r) => [r.key, r.state]));
  assert.equal(state.get('th:th-1'), 'in_progress'); // the task-linked thread wears its task's state
  assert.equal(state.get('tk:t-2'), 'in_review'); // …and so does a task that never grew a thread
  assert.equal(state.get('th:th-2'), null); // a chat has no dial
});

test('a caller without the state column reports null, not undefined', () => {
  const rows = historyRows({ threads: [], tasks: [task({ id: 't-9', number: 900 })], channelId: 'c-dev', channelSlug: 'dev', query: '' });
  assert.equal(rows[0]!.state, null);
});

// --- sessionGroups: the list's date buckets (Today / Yesterday / This week / Earlier) ---

/** local-time constructors on both sides, so these assertions hold in any timezone */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).toISOString();
const NOW = new Date(2026, 6, 29, 14, 30).getTime(); // Wed 29 Jul 2026, 2:30pm local
const srow = (key: string, when: string): HistoryRow<HistoryTask> => ({
  key,
  threadId: null,
  channelId: 'c-dev',
  channelSlug: 'dev',
  task: null,
  branch: null,
  title: key,
  snip: '',
  when,
  state: null,
});

test('the day boundary is calendar, not elapsed time: 00:01 today ≠ 23:59 yesterday', () => {
  // two minutes apart, two buckets — "what did I do today" is a calendar question
  const groups = sessionGroups([srow('a', at(2026, 6, 29, 0, 1)), srow('b', at(2026, 6, 28, 23, 59))], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday']);
  assert.deepEqual(groups[0]!.rows.map((r) => r.key), ['a']);
  assert.deepEqual(groups[1]!.rows.map((r) => r.key), ['b']);
});

test('This week reaches back six local days; the row a minute older is Earlier', () => {
  const groups = sessionGroups([
    srow('d2', at(2026, 6, 27, 9)),
    srow('d6', at(2026, 6, 23, 0, 0)), // local midnight six days back — the inclusive edge
    srow('d7', at(2026, 6, 22, 23, 59)), // one minute over it
  ], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['This week', 'Earlier']);
  assert.deepEqual(groups[0]!.rows.map((r) => r.key), ['d2', 'd6']);
  assert.deepEqual(groups[1]!.rows.map((r) => r.key), ['d7']);
});

test('the week window rolls back over a month end (day arithmetic, not 6×86400s)', () => {
  const groups = sessionGroups([
    srow('mar1', at(2026, 2, 1, 9)),
    srow('feb24', at(2026, 1, 24, 0, 0)),
    srow('feb23', at(2026, 1, 23, 23, 59)),
  ], new Date(2026, 2, 2, 10, 0).getTime()); // Mon 2 Mar 2026 — the window ends in February
  assert.deepEqual(groups.map((g) => g.label), ['Yesterday', 'This week', 'Earlier']);
  assert.deepEqual(groups[1]!.rows.map((r) => r.key), ['feb24']);
});

test('an empty bucket is omitted — never a header with nothing under it', () => {
  const groups = sessionGroups([srow('now', at(2026, 6, 29, 8)), srow('old', at(2026, 5, 2, 8))], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Earlier']);
  assert.deepEqual(sessionGroups([], NOW), []);
});

test('rows keep their newest-first order inside a bucket, and buckets read top-down', () => {
  const groups = sessionGroups([
    srow('t-late', at(2026, 6, 29, 13)),
    srow('t-early', at(2026, 6, 29, 9)),
    srow('yest', at(2026, 6, 28, 10)),
    srow('old', at(2026, 1, 3, 8)),
  ], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Earlier']);
  assert.deepEqual(groups[0]!.rows.map((r) => r.key), ['t-late', 't-early']); // input order, untouched
});

test('now is injected, never read: the same rows regroup under a later clock', () => {
  const rows = [srow('a', at(2026, 6, 29, 9))];
  assert.equal(sessionGroups(rows, NOW)[0]!.label, 'Today');
  assert.equal(sessionGroups(rows, new Date(2026, 6, 30, 9).getTime())[0]!.label, 'Yesterday');
  assert.equal(sessionGroups(rows, new Date(2026, 7, 12, 9).getTime())[0]!.label, 'Earlier');
});

test('a row stamped ahead of this clock sits in Today; an unparseable stamp still shows', () => {
  const groups = sessionGroups([srow('ahead', at(2026, 6, 30, 1)), srow('junk', 'not-a-date')], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Earlier']);
  assert.deepEqual(groups[0]!.rows.map((r) => r.key), ['ahead']); // another machine ran fast — not a reason to bury it
  assert.deepEqual(groups[1]!.rows.map((r) => r.key), ['junk']); // …and a bad timestamp loses its place, not its row
});

// --- roomBrief: the digest, pinned, once the feed is gone ---

const AGENTS = new Set(['a-rex', 'a-iris']);
const msg = (over: Partial<RoomMessage> & { id: string; created_at: string }): RoomMessage => ({
  author_kind: 'agent',
  author_id: 'a-rex',
  body: `body ${over.id}`,
  thread_id: null,
  task_id: null,
  ...over,
});

test('the brief is the newest agent-authored channel-root message', () => {
  const brief = roomBrief([
    msg({ id: 'm-1', created_at: '2026-07-28T09:00:00Z', body: '☀️ Morning status — #dev' }),
    msg({ id: 'm-2', created_at: '2026-07-29T09:00:00Z', body: '🌙 Evening status — #dev' }),
  ], AGENTS);
  assert.deepEqual(brief, { messageId: 'm-2', body: '🌙 Evening status — #dev', at: '2026-07-29T09:00:00Z' });
});

test('created_at decides it, not the array order', () => {
  const rows = [msg({ id: 'new', created_at: '2026-07-29T09:00:00Z' }), msg({ id: 'old', created_at: '2026-07-20T09:00:00Z' })];
  assert.equal(roomBrief(rows, AGENTS)?.messageId, 'new');
  assert.equal(roomBrief([...rows].reverse(), AGENTS)?.messageId, 'new');
});

test('a human’s room message is never the brief — the digest is an agent’s', () => {
  const brief = roomBrief([
    msg({ id: 'digest', created_at: '2026-07-28T09:00:00Z' }),
    msg({ id: 'mine', created_at: '2026-07-29T09:00:00Z', author_kind: 'human', author_id: 'u-geo' }),
  ], AGENTS);
  assert.equal(brief?.messageId, 'digest');
});

test('a conversation’s root or a task’s note is not the room’s brief', () => {
  // both ride the channel feed watch today (a thread ROOT stays in it, docs/31), and neither is
  // a digest — the daemon posts those with no taskId and no threadId at all
  const brief = roomBrief([
    msg({ id: 'digest', created_at: '2026-07-27T09:00:00Z' }),
    msg({ id: 'chat-root', created_at: '2026-07-28T09:00:00Z', thread_id: 'th-1' }),
    msg({ id: 'task-note', created_at: '2026-07-29T09:00:00Z', task_id: 't-1' }),
  ], AGENTS);
  assert.equal(brief?.messageId, 'digest');
});

test('absent thread_id/task_id columns still read as channel-root', () => {
  const brief = roomBrief([{ id: 'm-1', author_kind: 'agent', author_id: 'a-rex', body: 'digest', created_at: '2026-07-29T09:00:00Z' }], AGENTS);
  assert.equal(brief?.messageId, 'm-1');
});

test('an author outside the roster yields no brief rather than one signed by nobody', () => {
  assert.equal(roomBrief([msg({ id: 'm-1', created_at: '2026-07-29T09:00:00Z', author_id: 'a-retired' })], AGENTS), null);
  assert.equal(roomBrief([msg({ id: 'm-1', created_at: '2026-07-29T09:00:00Z' })], new Set()), null); // roster not synced yet
});

test('a room with no digest yet has no brief', () => {
  assert.equal(roomBrief([], AGENTS), null);
  assert.equal(roomBrief([msg({ id: 'm-1', created_at: '2026-07-29T09:00:00Z', author_kind: 'human', author_id: 'u-geo' })], AGENTS), null);
});

// --- roomBriefs: the stack behind the slot (docs/35 §10 — eviction was disappearance) ---

test('the stack is newest-first and capped, and roomBrief is its head', () => {
  const rows = ['26', '27', '28', '29', '30', '31'].map((d) => msg({ id: `m-${d}`, created_at: `2026-07-${d}T09:00:00Z` }));
  const briefs = roomBriefs(rows, AGENTS);
  assert.deepEqual(briefs.map((b) => b.messageId), ['m-31', 'm-30', 'm-29', 'm-28', 'm-27']);
  assert.equal(roomBrief(rows, AGENTS)?.messageId, briefs[0]!.messageId); // one slot, one head
  assert.equal(roomBriefs(rows, AGENTS, 2).length, 2);
});

test('a card-carrying room message is never a brief — it is needs-you material', () => {
  // an nmq question and an nmauth permission gate are answered by their BUTTONS; a one-line
  // brief would strip them off the one message that exists to be clicked
  const briefs = roomBriefs([
    msg({ id: 'digest', created_at: '2026-07-27T09:00:00Z', body: '☀️ Morning status — #dev' }),
    msg({ id: 'question', created_at: '2026-07-28T09:00:00Z', body: 'Which room?\n\n```nmq\n{"question":"where?"}\n```' }),
    msg({ id: 'auth', created_at: '2026-07-29T09:00:00Z', body: 'Approve?\n\n```nmauth\n{"provider":"anthropic"}\n```' }),
  ], AGENTS);
  assert.deepEqual(briefs.map((b) => b.messageId), ['digest']);
});

test('the input array is never reordered under the caller (the watch owns it)', () => {
  const rows = [msg({ id: 'old', created_at: '2026-07-20T09:00:00Z' }), msg({ id: 'new', created_at: '2026-07-29T09:00:00Z' })];
  roomBriefs(rows, AGENTS);
  assert.deepEqual(rows.map((m) => m.id), ['old', 'new']);
});

// --- the legacy pass: loose room messages, which no send can create any more (docs/35 §10) ---

const loose = (over: Partial<RoomMessage> & { id: string; created_at: string }): RoomMessage => ({
  author_kind: 'human',
  author_id: 'u-geo',
  body: `note ${over.id}`,
  thread_id: null,
  task_id: null,
  ...over,
});
const legacyRows = (messages: RoomMessage[]) =>
  historyRows({ threads: [], tasks: [], channelId: 'c-dev', channelSlug: 'dev', query: '', messages });

test('a loose human room message becomes a row keyed msg:<id>, titled by its first line', () => {
  const rows = legacyRows([loose({
    id: 'm-77',
    created_at: '2026-07-24T09:00:00Z',
    body: 'ship the pricing page this week\nthe tier table is the only blocker — atlas has the copy',
  })]);
  assert.deepEqual(rows.map((r) => r.key), ['msg:m-77']);
  assert.equal(rows[0]!.title, 'ship the pricing page this week');
  assert.equal(rows[0]!.snip, 'the tier table is the only blocker — atlas has the copy');
  assert.equal(rows[0]!.when, '2026-07-24T09:00:00Z');
  assert.equal(rows[0]!.state, null); // no task, no dial
  assert.equal(rows[0]!.threadId, null);
  assert.equal(rows[0]!.rootMessageId, 'm-77'); // …and the id a reply roots at (docs/31)
  assert.equal(rows[0]!.channelSlug, 'dev');
});

test('an agent’s room message is a BRIEF, not a legacy row — the two passes cannot both claim it', () => {
  const digest = msg({ id: 'digest', created_at: '2026-07-24T09:00:00Z' });
  assert.deepEqual(legacyRows([digest]), []);
  assert.equal(roomBriefs([digest], AGENTS).length, 1);
});

test('a thread root, a message inside a thread and a task note are all excluded', () => {
  const rows = legacyRows([
    loose({ id: 'keep', created_at: '2026-07-20T09:00:00Z' }),
    // the root of a session: its row is the SESSION's row — a second one would double it
    loose({ id: 'rooted', created_at: '2026-07-21T09:00:00Z', root_thread_id: 'th-1' }),
    loose({ id: 'in-thread', created_at: '2026-07-22T09:00:00Z', thread_id: 'th-2' }),
    loose({ id: 'task-note', created_at: '2026-07-23T09:00:00Z', task_id: 't-1' }),
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['msg:keep']);
});

test('legacy rows interleave with sessions by recency and honour the search', () => {
  const rows = historyRows({
    threads: [{ id: 'th-1', task_id: null, title: 'Sprint sync', last_body: 'all green', updated_at: '2026-07-22T09:00:00Z' }],
    tasks: [task({ id: 't-2', number: 102, title: 'pricing tiers', updated_at: '2026-07-20T09:00:00Z' })],
    channelId: 'c-dev',
    channelSlug: 'dev',
    query: '',
    messages: [loose({ id: 'm-9', created_at: '2026-07-21T09:00:00Z', body: 'the annual toggle is out' })],
  });
  assert.deepEqual(rows.map((r) => r.key), ['th:th-1', 'msg:m-9', 'tk:t-2']);
  const hits = historyRows({
    threads: [], tasks: [], channelId: 'c-dev', channelSlug: 'dev', query: 'annual',
    messages: [loose({ id: 'm-9', created_at: '2026-07-21T09:00:00Z', body: 'the annual toggle is out' }), loose({ id: 'm-8', created_at: '2026-07-21T09:00:00Z' })],
  });
  assert.deepEqual(hits.map((r) => r.key), ['msg:m-9']);
});

test('no messages input = no legacy pass, so Home (which has no room watch) is unchanged', () => {
  const rows = historyRows({
    threads: [{ id: 'th-1', task_id: null, title: 'Sprint sync', last_body: '', updated_at: '2026-07-22T09:00:00Z' }],
    tasks: [], channelId: null, channelSlug: '', query: '',
  });
  assert.deepEqual(rows.map((r) => r.key), ['th:th-1']); // …and no msg: row alongside it
  assert.equal(rows[0]!.rootMessageId, undefined); // only a legacy row carries one
});

test('briefPretty strips the machine framing and the em dashes, never the content', () => {
  assert.equal(
    briefPretty('\u2600\uFE0F Morning status — build - Awaiting review — needs a human/reviewer: 1005 Design and build Acme Robotics landing page'),
    'Awaiting review · needs a human/reviewer: 1005 Design and build Acme Robotics landing page',
  );
  // no boilerplate → only separators change
  assert.equal(briefPretty('Two scans landed — #1032 waiting on your accept'), 'Two scans landed · #1032 waiting on your accept');
  // hyphens inside words survive; only spaced hyphens are list glue
  assert.equal(briefPretty('marketing-site build - ready'), 'marketing-site build · ready');
  // already-clean prose passes through
  assert.equal(briefPretty('All quiet. Nothing needs you.'), 'All quiet. Nothing needs you.');
});

test('no room offers Routines as a tab — Automations is a nav destination that reads the scope', () => {
  // The count-gated tab is gone (2026-08-03). It was invisible in exactly the room where you
  // had not armed one yet, which is the discovery case it existed to serve; the destination is
  // always there and always countable, and picking a room in the nav head narrows it.
  for (const tabs of [roomTabsFor('build', false), roomTabsFor('marketing', true)]) {
    assert.equal(tabs.some((t) => t.id === 'routines'), false);
    assert.equal(tabs.some((t) => t.id === 'board'), false);
  }
});

test('briefPrettyFull keeps the document structure and strips only the frame', () => {
  const digest = '\u2600\uFE0F Morning status — #dev\n\n- #1046 is mid-build with patch — inert backdrop left\n- #1042 passed review\n\nBacklog holds 2.';
  const full = briefPrettyFull(digest);
  assert.ok(full.startsWith('- #1046'), full);            // bullets survive at line start
  assert.ok(full.includes('\n- #1042'), full);            // as does the list shape
  assert.ok(!full.includes('—'), full);                   // in-line em dashes become separators
  assert.ok(full.includes('patch · inert backdrop'), full);
  assert.ok(full.endsWith('Backlog holds 2.'), full);     // trailing paragraph intact
});

test('briefSummary prefers the agent-written summary line, floors to flattening', () => {
  // the instructed shape: heading, then ONE prose sentence, then bullets
  const instructed = '\u2600\uFE0F Morning status — #dev\nQuiet morning: one review waits on you, nothing blocked.\n- #1042 passed review\n- Backlog holds 2.';
  assert.equal(briefSummary(instructed), 'Quiet morning: one review waits on you, nothing blocked.');
  // legacy digest opens with bullets → the flattened floor, never an empty card
  const legacy = '\u2600\uFE0F Morning status — #dev\n- #1042 passed review — your accept merges it\n- Backlog holds 2.';
  assert.equal(briefSummary(legacy), '#1042 passed review · your accept merges it · Backlog holds 2.');
  // the cap ellipsizes without cutting mid-word garbage
  assert.ok(briefSummary('x'.repeat(400)).length <= 160);
});

test('rows carry the branch, and titles shed their markdown', () => {
  const rows = historyRows({
    threads: [{ id: 'th1', task_id: 'tk1', title: '**Routine — check**', updated_at: '2026-07-30T10:00:00Z' }],
    tasks: [task({ id: 'tk1', number: 1046, channel_id: 'c1', branch: 'nm/1046-ios-safari-focus-trap' }), task({ id: 'tk2', number: 1061, channel_id: 'c1', branch: null })],
    channelId: 'c1', channelSlug: 'dev', query: '',
  });
  const linked = rows.find((r) => r.key === 'th:th1');
  assert.equal(linked?.branch, 'nm/1046-ios-safari-focus-trap'); // the task-linked thread rides its task's branch
  assert.equal(linked?.title, 'Routine — check');                // ** stripped
  const bare = rows.find((r) => r.key === 'tk:tk2');
  assert.equal(bare?.branch, null);
});

// ── Thread-owned work (2026-08-17) ────────────────────────────────────────────
test('a unit anchored to a conversation NEVER earns a session row — its card lives in the thread', () => {
  const rows = historyRows({
    threads: [{ id: 'th1', title: 'Pricing rework', channel_id: 'c1', task_id: null, updated_at: '2026-08-17T10:00:00Z', mode: 'tasks' } as never],
    tasks: [
      { id: 'u1', number: 1057, title: 'Tiers redesign', description: null, channel_id: 'c1', parent_task_id: null, origin_thread_id: 'th1', updated_at: '2026-08-17T11:00:00Z', state: 'plan_review' } as never,
      { id: 'u2', number: 1058, title: 'Legacy bare task', description: null, channel_id: 'c1', parent_task_id: null, origin_thread_id: null, updated_at: '2026-08-17T09:00:00Z', state: 'todo' } as never,
    ],
    channelId: 'c1', channelSlug: 'dev', query: '',
  });
  const keys = rows.map((r) => r.key);
  assert.ok(keys.includes('th1') || keys.some((k) => String(k).includes('th1')), 'the conversation keeps its row');
  assert.ok(!rows.some((r) => r.task && (r.task as { id: string }).id === 'u1'), 'the anchored unit has NO row of its own');
  assert.ok(rows.some((r) => r.task && (r.task as { id: string }).id === 'u2'), 'a legacy bare task keeps its row until backfilled');
});

// George, 2026-08-26 (live): "rex created a subtask, but somehow it became a new task and now
// shows on the left nav again". Every task can grow its own thread, and the THREAD pass mapped
// every thread — so an anchored unit or a subtask appeared twice: as the card in the session
// that owns it, and as a row of its own. `bare` knew the rule; the thread pass did not.
test('an owned unit that GREW its own task thread still earns no row — card in one place, not two', () => {
  const rows = historyRows({
    threads: [
      { id: 'th1', title: 'Reply radar', channel_id: 'c1', task_id: null, updated_at: '2026-08-26T10:00:00Z', mode: 'tasks' } as never,
      // the unit's own task thread (rex posts its plan + beats there, so it exists)
      { id: 'th-u1', title: 'Reply radar, flowe.ai', channel_id: 'c1', task_id: 'u1', updated_at: '2026-08-26T11:00:00Z', mode: 'tasks' } as never,
      // a SUBTASK's thread — same rule, it rides its parent
      { id: 'th-s1', title: 'Collect metrics', channel_id: 'c1', task_id: 's1', updated_at: '2026-08-26T11:30:00Z', mode: 'tasks' } as never,
      // a board-born task's thread — this one IS its session and keeps its row
      { id: 'th-b1', title: 'Fix the hero', channel_id: 'c1', task_id: 'b1', updated_at: '2026-08-26T09:00:00Z', mode: 'tasks' } as never,
    ],
    tasks: [
      { id: 'u1', number: 1066, title: 'Reply radar, flowe.ai', description: null, channel_id: 'c1', parent_task_id: null, origin_thread_id: 'th1', updated_at: '2026-08-26T11:00:00Z', state: 'done' } as never,
      { id: 's1', number: 1067, title: 'Collect metrics', description: null, channel_id: 'c1', parent_task_id: 'u1', origin_thread_id: null, updated_at: '2026-08-26T11:30:00Z', state: 'todo' } as never,
      { id: 'b1', number: 1068, title: 'Fix the hero', description: null, channel_id: 'c1', parent_task_id: null, origin_thread_id: null, updated_at: '2026-08-26T09:00:00Z', state: 'todo' } as never,
    ],
    channelId: 'c1', channelSlug: 'dev', query: '',
  });
  const ids = rows.map((r) => (r.task as { id: string } | null)?.id ?? r.threadId);
  assert.ok(ids.includes('th1'), 'the owning conversation keeps its row');
  assert.ok(!ids.includes('u1'), 'the anchored unit does not reappear through its own thread');
  assert.ok(!ids.includes('s1'), 'the subtask rides its parent, never the nav');
  assert.ok(ids.includes('b1'), 'a board-born task IS its own session and keeps its row');
});

test('a conversation that UPGRADED into its own task thread keeps its row', () => {
  // the anchor is this very thread: hiding it would hide the conversation itself
  const rows = historyRows({
    threads: [{ id: 'th9', title: 'Tiers redesign', channel_id: 'c1', task_id: 'u9', updated_at: '2026-08-26T10:00:00Z', mode: 'tasks' } as never],
    tasks: [{ id: 'u9', number: 1070, title: 'Tiers redesign', description: null, channel_id: 'c1', parent_task_id: null, origin_thread_id: 'th9', updated_at: '2026-08-26T10:00:00Z', state: 'todo' } as never],
    channelId: 'c1', channelSlug: 'dev', query: '',
  });
  assert.equal(rows.length, 1);
  assert.equal((rows[0]!.task as { id: string } | null)?.id, 'u9');
});

test('a unit-card marker never leaks into a session snippet', () => {
  const rows = historyRows({
    threads: [{ id: 'th1', title: 'Pricing rework', channel_id: 'c1', task_id: null, updated_at: '2026-08-17T10:00:00Z', mode: 'tasks', last_body: 'Filing both here. ‹task:5b1f0d3e-8f2a-4c6e-9d17-2a9b64c7e001›' } as never],
    tasks: [], channelId: 'c1', channelSlug: 'dev', query: '',
  });
  const row = rows.find((r) => String(r.key).includes('th1'));
  assert.ok(row, 'the conversation has a row');
  assert.ok(!row!.snip.includes('‹task:'), 'raw marker stripped');
  assert.ok(row!.snip.includes('filed a task'), 'the human line stands in');
});
