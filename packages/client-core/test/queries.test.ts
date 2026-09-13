import { describe, expect, it } from 'vitest';
import * as q from '../src/queries';

// Cheap guard against a typo'd table/column name in a hand-written SQL string —
// each query must be a select against the table it claims to read.
const EXPECT: Record<string, string> = {
  CHANNELS_FOR_WORKSPACE: 'from channels',
  CHANNEL_MESSAGES: 'from messages',
  TASK_MESSAGES: 'from messages',
  TASKS_FOR_WORKSPACE: 'from tasks',
  NEEDS_YOU: 'from tasks',
  MACHINES_FOR_WORKSPACE: 'from machines',
  AGENTS_FOR_WORKSPACE: 'from agents',
  ARTIFACTS_FOR_TASK: 'from artifacts',
  PROJECTS_FOR_WORKSPACE: 'from projects',
  CHANNEL_PICKER_FOR_WORKSPACE: 'from channels',
  TASK_REFS_FOR_WORKSPACE: 'from tasks',
  ARTIFACT_REFS_FOR_WORKSPACE: 'from artifacts',
  // the cloud round's reads (S1.4)
  SESSION_THREADS_FOR_WORKSPACE: 'from threads',
  SESSION_TASKS_FOR_WORKSPACE: 'from tasks',
  OPEN_RUNS_FOR_WORKSPACE: 'from runs',
  OPEN_DECISIONS_FOR_WORKSPACE: 'from decisions',
  THREAD_MESSAGES: 'from messages',
  THREAD_HEAD: 'from threads',
  AGENTS_IN_CHANNEL: 'from agents',
  THREAD_ARTIFACTS: 'from artifacts',
  CODE_SESSIONS_FOR_WORKSPACE: 'from code_sessions',
  SCHEDULES_FOR_WORKSPACE: 'from schedules',
  SCHEDULE_RUN_THREADS: 'from threads',
  CONTENT_ITEMS_FOR_CALENDAR: 'from content_items',
  MACHINES_WITH_KIND_FOR_WORKSPACE: 'from machines',
  MEMBERS_FOR_WORKSPACE: 'from workspace_members',
  REPOS_FOR_PROJECT: 'from project_repos',
  CHANNELS_WITH_PROJECT_FOR_WORKSPACE: 'from channels',
  DEVELOPER_SEATS_FOR_WORKSPACE: 'from agents',
  REMOTE_REPOS_FOR_WORKSPACE: 'from repos',
};

// Every query naming a workspace must actually filter on one. The replica holds EVERY workspace
// you belong to (the sync rules are plural), so a `_FOR_WORKSPACE` that forgot its predicate
// would silently mix two workspaces together — which is exactly what shipped on mobile.
const WORKSPACE_SCOPED = [
  'CHANNELS_FOR_WORKSPACE', 'TASKS_FOR_WORKSPACE', 'NEEDS_YOU', 'MACHINES_FOR_WORKSPACE',
  'AGENTS_FOR_WORKSPACE', 'PROJECTS_FOR_WORKSPACE', 'CHANNEL_PICKER_FOR_WORKSPACE',
  'TASK_REFS_FOR_WORKSPACE', 'ARTIFACT_REFS_FOR_WORKSPACE',
  'SESSION_THREADS_FOR_WORKSPACE', 'SESSION_TASKS_FOR_WORKSPACE', 'OPEN_RUNS_FOR_WORKSPACE', 'OPEN_DECISIONS_FOR_WORKSPACE',
  'CODE_SESSIONS_FOR_WORKSPACE', 'SCHEDULES_FOR_WORKSPACE', 'CONTENT_ITEMS_FOR_CALENDAR', 'MACHINES_WITH_KIND_FOR_WORKSPACE',
  'MEMBERS_FOR_WORKSPACE', 'CHANNELS_WITH_PROJECT_FOR_WORKSPACE', 'DEVELOPER_SEATS_FOR_WORKSPACE', 'REMOTE_REPOS_FOR_WORKSPACE',
];

// The two session queries carry a PAGE, and the page is a parameter. Both used to be unbounded in
// practice (300 threads with a correlated subquery each, and every task in the workspace), which is
// what made a phone hot (George, 2026-09-06). A limit that is not a placeholder is a limit nobody
// can shrink, so the test asks for the placeholder rather than for a number.
const PAGED = ['SESSION_THREADS_FOR_WORKSPACE', 'SESSION_TASKS_FOR_WORKSPACE'];

describe('canonical queries', () => {
  it('the session queries take their page size as a parameter', () => {
    for (const name of PAGED) {
      const sql = ((q as unknown as Record<string, string>)[name] ?? '').toLowerCase();
      expect(sql, `${name} limits`).toContain('limit ?');
      expect(sql, `${name} orders before it limits`).toContain('order by t.updated_at desc');
      // the OUTER limit is the page; the `limit 1` inside the last-message subquery is legitimate
      expect(sql.trimEnd().endsWith('limit ?'), `${name} ends with the page limit`).toBe(true);
    }
  });

  it('every exported query is a select against its expected table', () => {
    for (const [name, from] of Object.entries(EXPECT)) {
      // `as unknown as` — the module exports a function now (pickActiveWorkspace), so it is no
      // longer assignable to Record<string, string>
      const sql = (q as unknown as Record<string, string>)[name];
      expect(sql, `${name} is exported`).toBeTypeOf('string');
      expect((sql ?? '').toLowerCase(), name).toContain('select');
      expect((sql ?? '').toLowerCase(), name).toContain(from);
    }
  });

  it('the needs-you inbox filters to exactly the human-gate states', () => {
    for (const state of ['design_review', 'plan_review', 'done', 'blocked']) {
      expect(q.NEEDS_YOU).toContain(`'${state}'`);
    }
  });

  it('every workspace-scoped query actually filters on a workspace', () => {
    for (const name of WORKSPACE_SCOPED) {
      // `as unknown as` — the module exports a function now (pickActiveWorkspace), so it is no
      // longer assignable to Record<string, string>
      const sql = (q as unknown as Record<string, string>)[name];
      expect(sql, `${name} is exported`).toBeTypeOf('string');
      expect(sql ?? '', name).toMatch(/workspace_id\s*=\s*\?/);
    }
  });
});

// ONE rule for desktop and mobile. Desktop's flat `resolved[0]` relocated people who accepted an
// invitation to an older workspace; mobile's `workspace_members limit 1` was not even
// deterministic. Sharing this is what stops them drifting apart again.
describe('pickActiveWorkspace', () => {
  const A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' };

  it('honours the stored choice even when it is not first', () => {
    expect(q.pickActiveWorkspace([A, B, C], 'c')).toBe(C);
  });

  it('falls back to the first when the stored choice is no longer a membership', () => {
    // left, or was removed from, the workspace the phone remembered
    expect(q.pickActiveWorkspace([B, C], 'a')).toBe(B);
  });

  it('falls back to the first with no stored choice at all', () => {
    expect(q.pickActiveWorkspace([A, B], null)).toBe(A);
    expect(q.pickActiveWorkspace([A, B], undefined)).toBe(A);
  });

  it('returns null before any membership has synced', () => {
    expect(q.pickActiveWorkspace([], 'a')).toBeNull();
  });
});
