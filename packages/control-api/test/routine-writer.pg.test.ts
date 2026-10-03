// The routine writer against the REAL schema. The memory twin is routine-writer.test.ts.
//
// What this locks down:
//   · schedule.create with `thread` links the session (threads.schedule_id), titles it after the routine,
//     and posts the divider there as the person, in the schedule's own transaction
//   · the store's guard: a session that already holds a routine refuses the link, and the refusal rolls the
//     whole arm back, so no schedule row is left without its session
//   · a coding thread and a session in another room are refused
//
// Its own workspace, like coding-threads.pg.test.ts. Run via scripts/test-pg.sh: skipped without DATABASE_URL.
import { ROUTINE_SCHEDULED_MARKER, createEvent, formatAddress, type Actor, type NMEvent } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB, { max: 1, prepare: false, onnotice: () => {} }) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const post = (actor: Actor, path: string, body: unknown) =>
  app!.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });

let george: Actor;
let WS = ''; let ROOM = ''; let OTHER = '';
const born = async (opts: Record<string, unknown> = {}) => {
  const threadId = crypto.randomUUID();
  await post(george, '/v1/messages', { workspace: WS, channel: ROOM, body: 'Make a routine: every weekday at 9, list the new issues.', threadId, ...opts });
  return threadId;
};
const routine = (thread: string, extra: Record<string, unknown> = {}) => ({
  type: 'schedule.create', channel: ROOM, title: 'New issues each morning', prompt: 'Goal: list the new issues.', cadence: 'weekdays', atTime: '09:00', tz: 'UTC', thread, ...extra,
});
const threadRow = async (id: string) => (await sql!`select schedule_id, title from threads where id = ${id}::uuid`)[0] as { schedule_id: string | null; title: string };
const ev = (type: 'message.posted' | 'schedule.created') => (ws: string): NMEvent => createEvent({ type, source: formatAddress({ kind: 'human', id: george.id }), target: `channel/${ROOM}`, workspace: ws, payload: {} });
const scheduleCount = async () => Number((await sql!`select count(*)::int as n from schedules where workspace_id = ${WS}::uuid`)[0]!['n']);

beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users (clerk_user_id, email) values ('clerk_rw_george', 'george@routine-writer.test')
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  george = { kind: 'human', id: u!['id'] as string };
  WS = (await j(await post(george, '/v1/commands', { type: 'workspace.create', name: 'Routine Writer', slug: `rw-${Date.now().toString(36)}` }))).workspaceId as string;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`;
  const proj = await j(await post(george, '/v1/commands', { type: 'project.create', workspace: WS, name: 'Ops' }));
  ROOM = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: proj.projectId, slug: 'dev' }))).channelId as string;
  OTHER = (await j(await post(george, '/v1/commands', { type: 'channel.create', workspace: WS, project: proj.projectId, slug: 'ops' }))).channelId as string;
});

afterAll(async () => { await store?.close(); await sql?.end(); });

describe.skipIf(!DB)('the routine writer against real postgres', () => {
  it('links the session, names it after the routine, and posts the divider as the person', async () => {
    const threadId = await born();
    const res = await post(george, '/v1/commands', routine(threadId));
    expect(res.status).toBe(200);
    const { scheduleId } = await j(res);
    expect(await threadRow(threadId)).toEqual({ schedule_id: scheduleId, title: 'New issues each morning' });
    const [divider] = await sql!`select author_kind, author_id, body, schedule_id from messages where thread_id = ${threadId}::uuid order by created_at desc limit 1`;
    expect(divider).toMatchObject({ author_kind: 'human', author_id: george.id, body: ROUTINE_SCHEDULED_MARKER, schedule_id: null });
    const [s] = await sql!`select payload from schedules where id = ${scheduleId}::uuid`;
    expect((s!['payload'] as Record<string, unknown>)['routine']).toBe(true);
  });

  it('a session that holds a routine refuses the link, and the refusal leaves no schedule behind', async () => {
    const threadId = await born();
    expect((await post(george, '/v1/commands', routine(threadId))).status).toBe(200);
    const before = await scheduleCount();
    // the store's own guard, under the handler's check: the session is taken between the check and the write
    const raced = await born();
    await store!.createSchedule(
      { channelId: ROOM, title: 'first', prompt: 'p', cadence: 'daily', atTime: '09:00', tz: 'UTC', weekday: null, nextRunAt: new Date(Date.now() + 3600e3).toISOString(), agentName: null, createdByKind: 'human', createdBy: george.id,
        session: { threadId: raced, dividerId: crypto.randomUUID(), author: { kind: 'human', id: george.id }, makeEvent: ev('message.posted') } },
      ev('schedule.created'),
    );
    await expect(store!.createSchedule(
      { channelId: ROOM, title: 'second', prompt: 'p', cadence: 'daily', atTime: '09:00', tz: 'UTC', weekday: null, nextRunAt: new Date(Date.now() + 3600e3).toISOString(), agentName: null, createdByKind: 'human', createdBy: george.id,
        session: { threadId: raced, dividerId: crypto.randomUUID(), author: { kind: 'human', id: george.id }, makeEvent: ev('message.posted') } },
      ev('schedule.created'),
    )).rejects.toThrow(/already holds a routine/);
    expect(await scheduleCount()).toBe(before + 1);
    const again = await post(george, '/v1/commands', routine(threadId));
    expect([again.status, (await j(again)).code]).toEqual([409, 'THREAD_HAS_ROUTINE']);
  });

  it('a coding thread and a session in another room are refused', async () => {
    const coding = await born({ threadKind: 'coding' });
    expect((await j(await post(george, '/v1/commands', routine(coding)))).code).toBe('CODING_THREAD');
    const elsewhere = await born();
    expect((await post(george, '/v1/commands', routine(elsewhere, { channel: OTHER }))).status).toBe(422);
    expect((await threadRow(elsewhere)).schedule_id).toBeNull();
  });
});
