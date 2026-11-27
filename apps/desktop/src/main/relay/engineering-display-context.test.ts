// THE DEFAULT AGENT OF A CODING CONVERSATION (2026-11-24, thread 774e7ec4): a thread that intake made a coding thread
// named no agent, and the access check refused every turn. The machine reads the room's orchestrator from its replica,
// the agent hq's Code chip shows (models/picks.ts codingDefaultAgent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { defaultEngineeringAgentId } from './engineering-display-context';
import type { AttDbLike } from '../agents';

function replica(rows: string): AttDbLike {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table threads (id text, workspace_id text, channel_id text);
    create table agents (id text, workspace_id text, name text, role text, kind text, retired_at text);
    create table agent_channels (agent_id text, channel_id text);
    insert into threads values ('t-marketing', 'w1', 'c-marketing'), ('t-build', 'w1', 'c-build'), ('t-empty', 'w1', 'c-empty');
    ${rows}`);
  return { getAll: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as Array<string | null>)) as T[] };
}

test('the room orchestrator, rex first, in this workspace only', async () => {
  const db = replica(`
    insert into agents values ('a-iris', 'w1', 'iris', 'designer', 'local', null), ('a-orca', 'w1', 'orca', 'orchestrator', 'local', null),
      ('a-rex', 'w1', 'Rex', 'orchestrator', null, null), ('a-other', 'w2', 'rex', 'orchestrator', 'local', null);
    insert into agent_channels values ('a-iris', 'c-marketing'), ('a-orca', 'c-marketing'), ('a-rex', 'c-marketing'), ('a-orca', 'c-build'), ('a-other', 'c-empty');`);
  assert.equal(await defaultEngineeringAgentId(db, 'w1', 't-marketing'), 'a-rex');
  assert.equal(await defaultEngineeringAgentId(db, 'w1', 't-build'), 'a-orca');
  assert.equal(await defaultEngineeringAgentId(db, 'w1', 't-empty'), null, 'an agent of another workspace never runs here');
  assert.equal(await defaultEngineeringAgentId(db, 'w2', 't-marketing'), null, 'a thread of another workspace has no default');
});

test('never a remote or retired agent, and never a room member that is no orchestrator', async () => {
  const db = replica(`
    insert into agents values ('a-rex', 'w1', 'rex', 'orchestrator', 'local', '2026-11-01'), ('a-far', 'w1', 'far', 'orchestrator', 'remote', null),
      ('a-patch', 'w1', 'patch', 'developer', 'local', null);
    insert into agent_channels values ('a-rex', 'c-marketing'), ('a-far', 'c-marketing'), ('a-patch', 'c-marketing');`);
  assert.equal(await defaultEngineeringAgentId(db, 'w1', 't-marketing'), null);
});
