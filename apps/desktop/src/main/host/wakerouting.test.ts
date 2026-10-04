// the GitHub grant's divider in a task thread wakes the agent whose card waited for it (the #694
// review, round 2). the state policy names nobody in review and the assignee in live work, and
// neither is the agent that asked.
//   node --import tsx --test apps/desktop/src/main/host/wakerouting.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { githubConnectedMarker, needDecisionQuestion } from '@neuramesh/shared';
import type { HostedAgent } from '../agents';
import { makeWakeRouting } from './wakerouting';

const agent = (id: string, role: string, channels = ['c1']): HostedAgent => ({ id, name: id, model: 'm', role, runtime: 'claude-code', channels: new Set(channels) });
const rex = agent('rex', 'orchestrator'); const patch = agent('patch', 'worker'); const scout = agent('scout', 'worker'); const iris = agent('iris', 'designer');
const ROOM = [rex, patch, scout, iris];
const DIVIDER = githubConnectedMarker('acme/app');
const QUESTION = needDecisionQuestion({ channel: 'c1', ask: 'Read the PR', why: '', connect: ['github'] })!;
/** a decision row as the server writes it for a card on task t1 */
const card = (asker: string, status: string, answeredAt: string | null, question = QUESTION) =>
  `insert into decisions values ('d-${asker}-${status}', 't1', 'agent', '${asker}', '${question.replace(/'/g, "''")}', '${status}', ${answeredAt ? `'${answeredAt}'` : 'null'});`;

/** the routing over a replica in SQLite. The returned function posts a message in the thread of task t1
 *  (patch holds it) and gives the names it wakes, and the setup bootstraps it runs. */
function thread(state: string, rows: string, roster = ROOM, kind = 'feature') {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table tasks (id text, number integer, title text, description text, state text, channel_id text, assignee_kind text, assignee_id text, kind text);
    create table decisions (id text, task_id text, asker_kind text, asker_id text, question text, status text, answered_at text);
    create table channels (id text, workspace_id text, kind text, marketing text);
    create table artifacts (channel_id text, name text);
    insert into tasks values ('t1', 12, 'Ship the nav', null, '${state}', 'c1', 'agent', 'patch', '${kind}');
    insert into channels values ('c1', 'w1', 'marketing', '{"setup_at":"2026-10-01T00:00:00Z"}');
    ${rows}`);
  const woke: string[] = [];
  const { routeThreadMessage } = makeWakeRouting({
    db: { getAll: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as string[])) },
    agents: new Map(roster.map((a) => [a.id, a])),
    processed: new Set<string>(),
    execQueue: { run: (_spec: unknown, fn: () => Promise<unknown>) => { void fn(); } },
    wakeThread: async (a: HostedAgent) => { woke.push(a.name); },
    runMarketingBootstrap: async (runner: HostedAgent) => { woke.push(`bootstrap:${runner.name}`); },
  } as unknown as Parameters<typeof makeWakeRouting>[0]);
  let n = 0;
  return async (body: string): Promise<string[]> => {
    woke.length = 0;
    await routeThreadMessage({ id: `m-${++n}`, task_id: 't1', channel_id: 'c1', body });
    return [...woke];
  };
}

test('the GitHub divider wakes the agent whose card waited for it, in review and in live work', async () => {
  const asked = card('scout', 'answered', '2026-10-04T10:00:00Z');
  // in review the policy is mention-only, so the divider woke nobody and the ask never continued
  assert.deepEqual(await (thread('in_review', asked))(DIVIDER), ['scout']);
  // in live work the policy wakes the assignee, who never made the ask
  assert.deepEqual(await (thread('in_progress', asked))(DIVIDER), ['scout']);
  for (const state of ['planning', 'done', 'shipping', 'verifying', 'blocked', 'designing']) {
    assert.deepEqual(await (thread(state, asked))(DIVIDER), ['scout'], state);
  }
});

test('the GitHub divider reads the newest answered GitHub card, never an open card or another question', async () => {
  const rows = [
    card('scout', 'answered', '2026-10-04T10:00:00Z'),
    card('iris', 'answered', '2026-10-04T10:05:00Z'),
    card('patch', 'open', null),
    card('rex', 'answered', '2026-10-04T10:09:00Z', 'Ship it on Friday?'),
  ].join('\n');
  assert.deepEqual(await (thread('in_review', rows))(DIVIDER), ['iris']);
});

test('the GitHub divider falls back to the room\'s coordinator, and only then to the state policy', async () => {
  // no card row, or an asker that is not in the room: the coordinator continues
  assert.deepEqual(await (thread('in_review', ''))(DIVIDER), ['rex']);
  const away = agent('nova', 'worker', ['c2']);
  assert.deepEqual(await (thread('in_review', card('nova', 'answered', '2026-10-04T10:00:00Z'), [...ROOM, away]))(DIVIDER), ['rex']);
  // a room with no coordinator: the policy decides, as for any message
  assert.deepEqual(await (thread('in_progress', '', [patch, scout]))(DIVIDER), ['patch']);
  assert.deepEqual(await (thread('in_review', '', [patch, scout]))(DIVIDER), []);
});

test('the GitHub divider in a setup task continues the ask, and does not start the brand bootstrap', async () => {
  // the setup room's docs are missing, so a person's reply there starts the bootstrap
  const post = thread('done', card('rex', 'answered', '2026-10-04T10:00:00Z'), [rex, agent('plume', 'marketer')], 'setup');
  assert.deepEqual(await post(DIVIDER), ['rex']);
  assert.deepEqual(await post('where are the brand docs?'), ['bootstrap:plume']);
});

test('a message that is not the divider keeps the state policy', async () => {
  const asked = card('scout', 'answered', '2026-10-04T10:00:00Z');
  assert.deepEqual(await (thread('in_review', asked))('looks good to me'), []);
  assert.deepEqual(await (thread('in_progress', asked))('looks good to me'), ['patch']);
  assert.deepEqual(await (thread('todo', asked))('looks good to me'), ['rex']);
  assert.deepEqual(await (thread('in_review', asked))('@scout can you check the migrations?'), ['scout']);
});
