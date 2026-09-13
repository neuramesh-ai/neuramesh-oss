// The 2026-08-11 round against the REAL schema — run via scripts/test-pg.sh, skipped without
// DATABASE_URL. Two schema changes ship here, and both are the kind only postgres can prove:
//
//   0118 `reopen` — closed was TERMINAL, enforced twice: the TS FSM and `nm_task_state_guard()`.
//     The trigger is the half the unit tests structurally cannot see, and it is the half that
//     bites LAST — an edge added to shared and not to the guard is accepted by the FSM and then
//     rejected by the database, which is the worst place to find out (0105's own lesson).
//
//   0119 `threads.schedule_id` — birth-only, exactly like `mode` and `brain_override` before it.
//     "Written on INSERT, never in the conflict branch" is a claim about a single ON CONFLICT
//     clause; the only honest test is a second message into the same thread.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const CH = 'c0000000-0000-0000-0000-00000000000b';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const db = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const post = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

const stateOf = async (taskId: string) => {
  const [row] = await db!<Array<{ state: string }>>`select state from tasks where id = ${taskId}::uuid`;
  return row?.state ?? null;
};

/** a task parked and then cancelled — the shortest honest road to `closed` */
const closedTask = async (title: string) => {
  const made = await j(await post(george, '/v1/commands', { type: 'task.create', workspace: WS, channel: CH, title }));
  const taskId = made.task.id as string;
  const killed = await post(george, '/v1/commands', { type: 'task.cancel', taskId });
  expect(killed.status).toBe(200);
  expect(await stateOf(taskId)).toBe('closed');
  return taskId;
};

afterAll(async () => { await store?.close(); await db?.end(); });

describe.skipIf(!DB)('0118 — reopen, the one edge out of closed', () => {
  it('a human reopens a closed task into todo — the trigger agrees with the FSM', async () => {
    const taskId = await closedTask('reopen me');
    const res = await post(george, '/v1/commands', { type: 'task.reopen', taskId });
    expect(res.status).toBe(200);
    // the DATABASE's own answer, not the handler's: if 0118 were missing, the FSM would have
    // allowed this and the trigger would have raised — the exact split 0105 warns about
    expect(await stateOf(taskId)).toBe('todo');
  });

  it('an agent cannot reopen its own cancelled work — closed stays a decision', async () => {
    const taskId = await closedTask('rex tries to undo a cancel');
    const res = await post(rex, '/v1/commands', { type: 'task.reopen', taskId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
    expect(await stateOf(taskId)).toBe('closed');
  });

  it('reopen lands in todo and nowhere else — closed is still the end of every other road', async () => {
    const taskId = await closedTask('no shortcut back to work');
    // the host aborts the run and drops the worktree on close, so resuming mid-phase would be a
    // state with no work behind it. Both layers refuse it; the DB is the one being read here.
    await expect(
      db!`update tasks set state = 'in_progress' where id = ${taskId}::uuid`,
    ).rejects.toThrow(/illegal task transition/i);
    expect(await stateOf(taskId)).toBe('closed');
    // …and the one legal edge really is legal at the trigger level too
    await db!`update tasks set state = 'todo' where id = ${taskId}::uuid`;
    expect(await stateOf(taskId)).toBe('todo');
  });
});

describe.skipIf(!DB)('0119 — a run thread knows which automation opened it', () => {
  const scheduleId = async () => {
    const id = crypto.randomUUID();
    await db!`insert into schedules (id, workspace_id, channel_id, title, cadence, at_time, tz, next_run_at, created_by_kind, created_by)
      values (${id}::uuid, ${WS}::uuid, ${CH}::uuid, 'Morning dependency audit', 'weekdays', '09:00', 'UTC', now(), 'human', ${george.id})`;
    return id;
  };
  const linkOf = async (threadId: string) => {
    const [row] = await db!<Array<{ schedule_id: string | null }>>`select schedule_id from threads where id = ${threadId}::uuid`;
    return row?.schedule_id ?? null;
  };

  it('the firing message stamps the thread it births', async () => {
    const sched = await scheduleId();
    const threadId = crypto.randomUUID();
    await post(george, '/v1/messages', { workspace: WS, channel: CH, threadId, scheduleId: sched, body: '⏱ **Routine — Morning dependency audit**\n\nCheck the top 20 deps.' });
    expect(await linkOf(threadId)).toBe(sched);
  });

  it('a later reply cannot re-attribute the conversation — birth-only, like mode and brain', async () => {
    const first = await scheduleId();
    const other = await scheduleId();
    const threadId = crypto.randomUUID();
    await post(george, '/v1/messages', { workspace: WS, channel: CH, threadId, scheduleId: first, body: '⏱ **Routine — Morning dependency audit**\n\nrun one' });
    await post(george, '/v1/messages', { workspace: WS, channel: CH, threadId, scheduleId: other, body: 'nice, file the CVE' });
    expect(await linkOf(threadId)).toBe(first);
  });

  it('an ordinary send leaves it null — a chat is not somebody\'s run', async () => {
    const threadId = crypto.randomUUID();
    await post(george, '/v1/messages', { workspace: WS, channel: CH, threadId, body: 'what broke the drawer?' });
    expect(await linkOf(threadId)).toBeNull();
  });

  it('removing the automation keeps its history — the conversations still happened', async () => {
    const sched = await scheduleId();
    const threadId = crypto.randomUUID();
    await post(george, '/v1/messages', { workspace: WS, channel: CH, threadId, scheduleId: sched, body: '⏱ **Routine — Morning dependency audit**\n\nrun one' });
    await db!`delete from schedules where id = ${sched}::uuid`;
    // `on delete set null`, never cascade: deleting a schedule must not delete the threads it opened
    const [row] = await db!<Array<{ n: number }>>`select count(*)::int as n from threads where id = ${threadId}::uuid`;
    expect(row?.n).toBe(1);
    expect(await linkOf(threadId)).toBeNull();
  });
});
