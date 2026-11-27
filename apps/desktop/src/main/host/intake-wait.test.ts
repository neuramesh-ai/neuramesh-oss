// The intake wait (round 9): a new thread's first message waits, briefly, for nm-api's decision, and
// every other message passes at once.
//   node --import tsx --test apps/desktop/src/main/host/intake-wait.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForIntake, type IntakeWaitDb } from './intake-wait';

type Thread = { intake: string | null; kind: string | null; home_agent_id: string | null; schedule_id: string | null; origin: string | null; task_id: string | null; created_at: string | null };
const NOW = Date.parse('2026-11-06T17:50:56.000Z');

/** a replica with one thread and its message counts. `land` writes the decision after `afterReads` thread reads */
function replica(over: Partial<Thread> = {}, counts = { humans: 1, agents: 0 }, land?: { afterReads: number; intake: string }): IntakeWaitDb & { reads: number } {
  const t: Thread = { intake: null, kind: 'chat', home_agent_id: null, schedule_id: null, origin: 'web', task_id: null, created_at: '2026-11-06T17:50:55.288Z', ...over };
  const db = {
    reads: 0,
    async getAll<T>(sql: string): Promise<T[]> {
      if (sql.includes('from threads')) {
        db.reads += 1;
        if (land && db.reads > land.afterReads) t.intake = land.intake;
        return [{ ...t } as T];
      }
      return [counts as T];
    },
  };
  return db;
}
/** a clock the sleeps move, so a test never really waits */
const clock = () => {
  let at = NOW;
  return { now: () => at, sleep: async (ms: number) => { at += ms; } };
};

test('a first message waits until the decision lands, then the routing reads the thread again', async () => {
  const db = replica({}, undefined, { afterReads: 3, intake: '{"v":1}' });
  assert.equal(await waitForIntake(db, 't1', { maxWaitMs: 7000, ...clock() }), 'landed');
  assert.equal(db.reads, 4);
});

test('a decision that never lands times out after the wait, and the routing proceeds as before', async () => {
  const c = clock();
  assert.equal(await waitForIntake(replica(), 't1', { maxWaitMs: 7000, ...c }), 'timeout');
  assert.ok(c.now() - NOW >= 7000 && c.now() - NOW < 7300);
});

test('a decision already there passes at once', async () => {
  const db = replica({ intake: '{"v":1}' });
  assert.equal(await waitForIntake(db, 't1', { maxWaitMs: 7000, ...clock() }), 'landed');
  assert.equal(db.reads, 1);
});

test('every message intake does not decide passes at once', async () => {
  const none = async (db: IntakeWaitDb) => assert.equal(await waitForIntake(db, 't1', { maxWaitMs: 7000, ...clock() }), 'none');
  await none(replica({ kind: 'coding' })); // the repo chip: the coding runtime owns it already
  await none(replica({ home_agent_id: 'a1' })); // an Agent Desk home
  await none(replica({ schedule_id: 's1' })); // a routine
  await none(replica({ origin: 'routine' }));
  await none(replica({ task_id: 'k1' })); // a task thread
  await none(replica({}, { humans: 2, agents: 0 })); // a later turn
  await none(replica({}, { humans: 1, agents: 1 })); // an agent already answered
  await none(replica({ created_at: '2026-11-06T17:40:00.000Z' })); // an old thread (the dead-letter sweep)
  await none({ getAll: async () => [] }); // no such thread in the replica
  await none({ getAll: async () => { throw new Error('no such column: intake'); } }); // an older replica schema
});

test('NM_INTAKE_WAIT_MS=0 turns the wait off', async () => {
  assert.equal(await waitForIntake(replica(), 't1', { maxWaitMs: 0, ...clock() }), 'none');
});
