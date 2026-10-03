// routine or content (host/routinerule.ts): a scheduled draft's session keeps its schedule id, but
// the machinery built for routines, where no person is in the loop, skips it (George, 2026-09-27:
// "Guard the routine rules"). the pure rule is @neuramesh/shared isRoutineSchedule, tested there.
// every daemon reader that uses it runs here on real SQLite behind the replica's `get` and `getAll`,
// as host/lookups.test.ts does.
// run from apps/desktop: pnpm exec tsx --test src/main/host/routinerule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { isRoutineThread, isRoutineUnit } from './routinerule';
import { gatherRoutineThreads, pickStrandedRoutines, sweepMessages } from './routineresume';
import { makeDesignNotify } from './designnotify';
import { startRoutineBuildWatch } from './planroute';
import { ROUTINE_NOTE, routineNoteFor } from './orchestratorturn';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const sqlite = (() => { try { return new Database(':memory:'); } catch { return null; } })();
const skip = sqlite ? false : 'better-sqlite3 is built for Electron\'s ABI — run under pnpm test, which rebuilds it';

// one marketing room and one build room. s-content is a scheduled draft run, s-marked a routine the
// launcher armed in the marketing room, s-legacy a row armed before the marker, in a build room, and
// s-gone a schedule the replica does not hold. the resume and the sweep read the sessions of the
// last hour or two. the units anchor to older sessions of the same schedules (30 h, outside the
// resume's window), because the resume leaves alone any session that anchors a unit.
const OLD = at(30 * 60);
sqlite?.exec(`
  create table channels (id text primary key, workspace_id text, slug text, kind text);
  create table schedules (id text primary key, workspace_id text, channel_id text, payload text);
  create table threads (id text primary key, channel_id text, schedule_id text, created_at text, updated_at text);
  create table messages (id text primary key, channel_id text, thread_id text, task_id text, author_kind text, author_id text, body text, created_at text, schedule_id text);
  create table tasks (id text primary key, number integer, title text, description text, requirements text, workspace_id text, channel_id text, state text,
    plan_approved_at text, offered_agent_id text, assignee_id text, parent_task_id text, repo_id text, work_plan text, origin_thread_id text);
  create table artifacts (id text primary key, task_id text, kind text, name text, promoted integer);
  create table runs (id text primary key, thread_id text, state text);
  insert into channels values ('ch-mkt', 'ws-1', 'marketing', 'marketing'), ('ch-build', 'ws-1', 'build', 'build');
  insert into schedules values
    ('s-content', 'ws-1', 'ch-mkt', '{"prompt":"Draft one X post."}'),
    ('s-marked', 'ws-1', 'ch-mkt', '{"prompt":"Audit the account.","routine":true}'),
    ('s-legacy', 'ws-1', 'ch-build', '{"prompt":"Check the deps."}');
  insert into threads (id, channel_id, schedule_id, created_at) values
    ('th-content', 'ch-mkt', 's-content', '${at(120)}'), ('th-marked', 'ch-mkt', 's-marked', '${at(119)}'),
    ('th-person', 'ch-mkt', null, '${at(117)}'), ('th-lost', 'ch-mkt', 's-gone', '${at(116)}'),
    ('th-content-old', 'ch-mkt', 's-content', '${OLD}'), ('th-marked-old', 'ch-mkt', 's-marked', '${OLD}'),
    ('th-legacy-old', 'ch-build', 's-legacy', '${OLD}'), ('th-lost-old', 'ch-mkt', 's-gone', '${OLD}');
  insert into messages (id, channel_id, thread_id, task_id, author_kind, author_id, body, created_at) values
    ('m-draft', 'ch-mkt', 'th-content', null, 'agent', 'plume', 'Scheduled draft · Morning post · for 09:00', '${at(120)}'),
    ('m-reply', 'ch-mkt', 'th-content', null, 'human', 'george', 'make it shorter', '${at(60)}'),
    ('m-routine', 'ch-mkt', 'th-marked', null, 'human', 'george', 'Routine · X audit', '${at(119)}'),
    ('m-person', 'ch-mkt', 'th-person', null, 'human', 'george', 'what is on the calendar?', '${at(30)}'),
    ('m-lost', 'ch-mkt', 'th-lost', null, 'human', 'george', 'Routine · Old audit', '${at(116)}');
  insert into tasks values
    ('t-content', 1, 'Landing page', '', null, 'ws-1', 'ch-mkt', 'todo', '${at(10)}', null, null, null, null, '{"legs":["design","build"]}', 'th-content-old'),
    ('t-marked', 2, 'Audit report', '', null, 'ws-1', 'ch-mkt', 'todo', '${at(10)}', null, null, null, null, '{"legs":["design","build"]}', 'th-marked-old'),
    ('t-legacy', 3, 'Deps report', '', null, 'ws-1', 'ch-build', 'todo', '${at(10)}', null, null, null, null, '{"legs":["build"]}', 'th-legacy-old'),
    ('t-repo', 4, 'Repo work', '', null, 'ws-1', 'ch-mkt', 'todo', '${at(10)}', null, null, null, 'r-1', '{"legs":["design","build"]}', 'th-marked-old'),
    ('t-person', 5, 'Person work', '', null, 'ws-1', 'ch-mkt', 'todo', '${at(10)}', null, null, null, null, '{"legs":["design","build"]}', 'th-person'),
    ('t-lost', 6, 'Lost work', '', null, 'ws-1', 'ch-mkt', 'todo', '${at(10)}', null, null, null, null, '{"legs":["build"]}', 'th-lost-old');
  insert into artifacts values
    ('a-1', 't-content', 'design', 'design-mockup-v1-hero.html', 1), ('a-2', 't-marked', 'design', 'design-mockup-v1-hero.html', 1),
    ('a-3', 't-person', 'design', 'design-mockup-v1-hero.html', 1);
`);

function replica() {
  return {
    get: async (sql: string, params: unknown[] = []) => {
      const row = sqlite!.prepare(sql).get(...(params as never[]));
      if (row === undefined) throw new Error('no rows'); // the replica's contract
      return row;
    },
    getAll: async <T,>(sql: string, params: unknown[] = []) => sqlite!.prepare(sql).all(...(params as never[])) as T[],
    watch: (sql: string, params: unknown[], h: { onResult: (r: { rows?: { _array?: unknown[] } }) => void }) => {
      h.onResult({ rows: { _array: sqlite!.prepare(sql).all(...(params as never[])) } });
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('a conversation is a routine\'s only when a routine opened it', { skip }, async () => {
  const db = replica();
  assert.equal(await isRoutineThread(db, 'th-marked'), true);
  assert.equal(await isRoutineThread(db, 'th-legacy-old'), true);
  assert.equal(await isRoutineThread(db, 'th-content'), false, 'a content schedule\'s session keeps its person');
  assert.equal(await isRoutineThread(db, 'th-person'), false);
  assert.equal(await isRoutineThread(db, 'th-lost'), false, 'a schedule row that is gone is no routine, as on the server');
  assert.equal(await isRoutineThread(db, null), false);
});

test('the orchestrator hears "hands-off" in a routine\'s session, and never in a draft\'s session', { skip }, async () => {
  const db = replica();
  assert.equal(await routineNoteFor(db, 'th-marked'), ROUTINE_NOTE);
  // the server births a unit here gated, so a note that says it "starts immediately" would promise work that waits on the person
  assert.equal(await routineNoteFor(db, 'th-content'), '');
  assert.equal(await routineNoteFor(db, 'th-person'), '');
  assert.equal(await routineNoteFor(db, null), '');
});

test('a unit is a routine\'s only when a routine opened its conversation, and never repo work', { skip }, async () => {
  const db = replica();
  assert.equal(await isRoutineUnit(db, 't-marked'), true);
  assert.equal(await isRoutineUnit(db, 't-legacy'), true);
  assert.equal(await isRoutineUnit(db, 't-content'), false, 'a content schedule\'s session keeps its person');
  assert.equal(await isRoutineUnit(db, 't-repo'), false, 'code merges on a person\'s word');
  assert.equal(await isRoutineUnit(db, 't-person'), false);
  assert.equal(await isRoutineUnit(db, 't-lost'), false, 'a schedule row that is gone is no routine, as on the server');
  assert.equal(await isRoutineUnit(db, 't-missing'), false);
});

test('the resume gathers a routine\'s session and never a content schedule\'s', { skip }, async () => {
  const gathered = await gatherRoutineThreads(replica(), { id: 'ch-mkt' }, NOW);
  assert.deepEqual(gathered.map((c) => c.threadId), ['th-marked']);
  // the reply in the draft's session waits an hour with no answer. the resume must not post the
  // drafting prompt again as the owner: the agent would draft a second post and the reply would stay unanswered
  assert.deepEqual(pickStrandedRoutines(gathered, NOW).map((c) => c.threadId), ['th-marked']);
});

test('the monitor sweep reads a content schedule\'s session and leaves a routine\'s to the resume', { skip }, async () => {
  const bodies = (await sweepMessages(replica(), 'ch-mkt')).map((m) => m.body);
  assert.ok(bodies.includes('make it shorter'), 'the stranded reply reaches the sweep');
  assert.ok(bodies.includes('Scheduled draft · Morning post · for 09:00'));
  assert.ok(bodies.includes('what is on the calendar?'));
  assert.ok(!bodies.includes('Routine · X audit'), 'the resume owns a routine\'s session');
});

test('a design round in a content schedule\'s session asks its person, and a routine\'s round asks nobody', { skip }, async () => {
  const posted: Array<{ taskId?: string; body: string }> = [];
  const { orchDesignNotify } = makeDesignNotify({
    db: replica(), workspace: 'ws-1',
    post: async (_path: string, _actor: unknown, body: { taskId?: string; body: string }) => { posted.push(body); return { ok: true } as Response; },
    alog: () => () => {}, ownerHandle: async () => '@george', guards: { designNotified: new Set<string>() },
  } as never);
  const rex = { id: 'a-rex', name: 'rex', role: 'orchestrator' } as never;
  await orchDesignNotify(rex, { id: 't-content', number: 1, title: 'Landing page', channel_id: 'ch-mkt' } as never);
  await orchDesignNotify(rex, { id: 't-marked', number: 2, title: 'Audit report', channel_id: 'ch-mkt' } as never);
  assert.deepEqual(posted.map((p) => p.taskId), ['t-content']);
  assert.match(posted[0]!.body, /ready for your review/);
});

test('the build offer after a hands-off design round goes to a routine\'s unit, never a content schedule\'s', { skip }, async () => {
  const offered: string[] = [];
  startRoutineBuildWatch({
    db: replica() as never, workspace: 'ws-1',
    agents: new Map([['rex', { id: 'a-rex', role: 'orchestrator', channels: new Set(['ch-mkt', 'ch-build']) }]]),
    offerPlanToWorker: (async (_o: unknown, t: { id: string }) => { offered.push(t.id); }) as never,
  });
  await settle();
  // the person approved the content unit's round themselves: their word wakes the orchestrator, who picks the builder
  assert.deepEqual(offered, ['t-marked']);
});
