// Unroutable-todo detection (Mission Control "needs you", docs/12 §6): the
// #marketing case — a todo task in a room whose only member is the orchestrator
// must surface to the human; anything with an actor or an eligible taker must not.
import { describe, expect, it } from 'vitest';
import { isUnroutableTodo, rowsInProject, taskProjectId, tasksInProject, unroutableTodos } from '../src/staffing';

const task = (over: Partial<Parameters<typeof isUnroutableTodo>[0]> = {}) => ({
  state: 'todo',
  assignee_id: null,
  offered_agent_id: null,
  channel_id: 'c-marketing',
  ...over,
});
const rex = { role: 'orchestrator', channel_ids: 'c-dev,c-marketing' };
const patch = { role: 'developer', channel_ids: 'c-dev' };

describe('isUnroutableTodo', () => {
  it('flags the #marketing case: todo, unoffered, only the orchestrator in the room', () => {
    expect(isUnroutableTodo(task(), [rex, patch])).toBe(true);
  });

  it('an eligible agent in the channel clears it — any non-orchestrator role counts', () => {
    for (const role of ['worker', 'developer', 'reviewer', 'designer', 'architect', 'sales']) {
      expect(isUnroutableTodo(task(), [rex, { role, channel_ids: 'c-marketing' }])).toBe(false);
    }
  });

  it('the orchestrator never counts as a taker', () => {
    expect(isUnroutableTodo(task(), [rex])).toBe(true);
    expect(isUnroutableTodo(task(), [])).toBe(true);
  });

  it('a retired agent in the room does not staff it (forward-compat with 0054)', () => {
    expect(isUnroutableTodo(task(), [rex, { role: 'worker', channel_ids: 'c-marketing', retired_at: '2026-07-01T00:00:00Z' }])).toBe(true);
  });

  it('an offer, an assignee, or any non-todo state means someone owns it', () => {
    expect(isUnroutableTodo(task({ offered_agent_id: 'a1' }), [rex])).toBe(false);
    expect(isUnroutableTodo(task({ assignee_id: 'a1' }), [rex])).toBe(false);
    for (const state of ['backlog', 'planning', 'in_progress', 'blocked', 'done', 'accepted', 'closed']) {
      expect(isUnroutableTodo(task({ state }), [rex])).toBe(false);
    }
  });

  it('membership matches by exact channel id in the csv (no substring hits)', () => {
    // 'c-marketing' must not be staffed by an agent whose id list contains 'c-marketing-eu'
    expect(isUnroutableTodo(task(), [{ role: 'worker', channel_ids: 'c-marketing-eu' }])).toBe(true);
    expect(isUnroutableTodo(task(), [{ role: 'worker', channel_ids: ' c-marketing ,c-dev' }])).toBe(false);
  });

  it('unroutableTodos filters a board', () => {
    const board = [task(), task({ channel_id: 'c-dev' }), task({ state: 'in_review' })];
    expect(unroutableTodos(board, [rex, patch]).map((t) => t.channel_id)).toEqual(['c-marketing']);
  });
});

describe('taskProjectId — a task belongs to its channel’s project', () => {
  const channels = [{ id: 'c-build', project_id: 'p1' }, { id: 'c-mkt', project_id: 'p2' }];

  it('prefers the task’s own stamp', () => {
    expect(taskProjectId({ channel_id: 'c-build', project_id: 'p9' }, channels)).toBe('p9');
  });

  it('DERIVES from the channel when the column is null — the row that used to fall out of every project', () => {
    expect(taskProjectId({ channel_id: 'c-mkt', project_id: null }, channels)).toBe('p2');
    expect(taskProjectId({ channel_id: 'c-build' }, channels)).toBe('p1');
  });

  it('is null only when nothing can resolve it', () => {
    expect(taskProjectId({ channel_id: 'c-gone', project_id: null }, channels)).toBe(null);
    expect(taskProjectId({ channel_id: 'c-mkt', project_id: null }, [])).toBe(null);
  });

  it('tasksInProject keeps a null-stamped task in its channel’s project, not out of all of them', () => {
    const tasks = [
      { id: 'a', channel_id: 'c-build', project_id: 'p1' },
      { id: 'b', channel_id: 'c-mkt', project_id: null },   // the #1 shape
      { id: 'c', channel_id: 'c-mkt', project_id: 'p2' },
    ];
    expect(tasksInProject(tasks, channels, 'p2').map((t) => t.id)).toEqual(['b', 'c']);
    expect(tasksInProject(tasks, channels, 'p1').map((t) => t.id)).toEqual(['a']);
    expect(tasksInProject(tasks, channels, null)).toHaveLength(3); // no active project = no scoping
  });
});

describe('rowsInProject — the conversation surfaces follow the work axis', () => {
  // every project is seeded with the SAME starter slugs, so two rooms called #marketing in two
  // projects is the normal case — scoping has to go by channel id, never by name
  const channels = [
    { id: 'c-build', project_id: 'p1' },
    { id: 'c-mkt', project_id: 'p1' },
    { id: 'c-mkt-2', project_id: 'p2' },
    { id: 'c-orphan', project_id: null },
  ];
  const rows = [
    { id: 'th-1', channel_id: 'c-build' },
    { id: 'th-2', channel_id: 'c-mkt' },
    { id: 'th-3', channel_id: 'c-mkt-2' },
    { id: 'th-4', channel_id: 'c-orphan' },
    { id: 'th-5', channel_id: 'c-not-replicated-yet' },
  ];

  it('keeps only the rows whose room belongs to the project — the leak that showed p2 threads under p1', () => {
    expect(rowsInProject(rows, channels, 'p1').map((r) => r.id)).toEqual(['th-1', 'th-2']);
    expect(rowsInProject(rows, channels, 'p2').map((r) => r.id)).toEqual(['th-3']);
  });

  it('drops a row whose channel is unknown rather than leaking it into every project', () => {
    // an orphan room and an unreplicated one are both "not this project's" — the alternative is
    // a row that appears under whichever project you happen to have selected
    expect(rowsInProject(rows, channels, 'p1').map((r) => r.id)).not.toContain('th-4');
    expect(rowsInProject(rows, channels, 'p2').map((r) => r.id)).not.toContain('th-5');
  });

  it('no active project = no scoping, same contract as tasksInProject', () => {
    expect(rowsInProject(rows, channels, null)).toHaveLength(5);
  });

  it('an empty project yields an empty list, never the unscoped one', () => {
    // the freshly-created-project case: its rooms have not replicated, so it has NOTHING to show
    expect(rowsInProject(rows, channels, 'p-new')).toEqual([]);
  });
});
