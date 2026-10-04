// Routine sessions (docs/design/routine-sessions-2026-09/plan.md, PR 1), against the REAL schema:
//   · a run's opener keeps its schedule on the message (0145), a reply in the session does not
//   · a schedule id of another workspace, or none that exists, is dropped, and the post still lands
//   · schedule.run_now makes the row due at once, and refuses a paused row with the way out
//   · the session wears the routine's title: a later run renames it until a person names it (PR 2)
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const call = (path: string, actor: Actor, body: unknown) => app!.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
  body: JSON.stringify(body),
});

let owner: Actor;
let WS = ''; let CHANNEL = ''; let SCHEDULE = '';

beforeAll(async () => {
  if (!sql) return;
  const [u] = await sql`insert into nm_users (clerk_user_id, email) values ('clerk_rs_owner', 'owner@routine-sessions.test')
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  owner = { kind: 'human', id: u!['id'] as string };
  const made = await j(await call('/v1/commands', owner, { type: 'workspace.create', name: 'Routine Sessions', slug: `rs-${Date.now().toString(36)}` }));
  WS = made.workspaceId; CHANNEL = made.channelId;
  await sql`update workspaces set plan = 'cloud' where id = ${WS}::uuid`; // schedules are Pro
  const s = await j(await call('/v1/commands', owner, { type: 'schedule.create', channel: CHANNEL, title: 'Morning dependency audit', prompt: 'Check our top 20 dependencies.', cadence: 'daily', atTime: '09:00', tz: 'UTC', routine: true }));
  SCHEDULE = s.scheduleId;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

async function post(body: Record<string, unknown>): Promise<string> {
  const r = await call('/v1/messages', owner, { workspace: WS, channel: CHANNEL, ...body });
  expect(r.status).toBe(200);
  return (await j(r)).message.id as string;
}
const scheduleOf = async (id: string) => ((await sql!`select schedule_id from messages where id = ${id}`)[0]!['schedule_id'] ?? null) as string | null;

describe.skipIf(!DB)('routine sessions on the real schema', () => {
  it('the opener keeps its schedule, and a reply in the same session does not', async () => {
    const threadId = crypto.randomUUID();
    const opener = await post({ threadId, scheduleId: SCHEDULE, body: 'Morning dependency audit\n\nday one' });
    const reply = await post({ threadId, body: 'I read the first ten packages.' });
    const second = await post({ threadId, scheduleId: SCHEDULE, body: 'Morning dependency audit\n\nday two' });
    expect(await scheduleOf(opener)).toBe(SCHEDULE);
    expect(await scheduleOf(reply)).toBeNull();
    expect(await scheduleOf(second)).toBe(SCHEDULE);
  });

  it('a schedule id that is not this workspace\'s is dropped, and the post lands', async () => {
    const id = await post({ threadId: crypto.randomUUID(), scheduleId: crypto.randomUUID(), body: 'Routine · stray' });
    expect(await scheduleOf(id)).toBeNull();
  });

  it("the session wears the routine's title, follows a rename at the next run, and keeps a person's name", async () => {
    const titleOf = async (id: string) => (await sql!`select title from threads where id = ${id}::uuid`)[0]!['title'] as string;
    const rename = (title: string) => call('/v1/commands', owner, { type: 'schedule.update', schedule: SCHEDULE, title, prompt: 'Check our top 20 dependencies.', cadence: 'daily', atTime: '09:00', tz: 'UTC' });
    const threadId = crypto.randomUUID();
    await post({ threadId, scheduleId: SCHEDULE, body: 'Routine · Morning dependency audit\n\nday one' });
    expect(await titleOf(threadId)).toBe('Morning dependency audit');
    await post({ threadId, body: 'I read the first ten packages.' });
    expect((await rename('Evening dependency audit')).status).toBe(200);
    expect(await titleOf(threadId)).toBe('Morning dependency audit');
    await post({ threadId, scheduleId: SCHEDULE, body: 'Routine · Evening dependency audit\n\nday two' });
    expect(await titleOf(threadId)).toBe('Evening dependency audit');
    const agent = await call('/v1/commands', { kind: 'agent', id: crypto.randomUUID(), role: 'orchestrator' }, { type: 'thread.update', workspace: WS, threadId, title: 'Dependency check-in' });
    expect(agent.status).toBe(409);
    expect((await call('/v1/commands', owner, { type: 'thread.update', workspace: WS, threadId, title: 'Deps check' })).status).toBe(200);
    await rename('Night dependency audit');
    await post({ threadId, scheduleId: SCHEDULE, body: 'Routine · Night dependency audit\n\nday three' });
    expect(await titleOf(threadId)).toBe('Deps check');
  });

  it('run now makes the row due at once, and a paused row is refused', async () => {
    expect((await call('/v1/commands', owner, { type: 'schedule.run_now', schedule: SCHEDULE })).status).toBe(200);
    const [row] = await sql!`select next_run_at <= now() as due from schedules where id = ${SCHEDULE}::uuid`;
    expect(row!['due']).toBe(true);
    await call('/v1/commands', owner, { type: 'schedule.set_status', schedule: SCHEDULE, status: 'paused' });
    const paused = await call('/v1/commands', owner, { type: 'schedule.run_now', schedule: SCHEDULE });
    expect(paused.status).toBe(422);
    expect((await j(paused)).error).toMatch(/Resume it, then run it/);
  });
});
