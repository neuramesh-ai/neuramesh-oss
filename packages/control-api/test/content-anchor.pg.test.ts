// content.anchor against the REAL schema (George, 2026-09-27: Generate image failed on the web and
// the phone with "no conversation to ask in"). A tab or the phone opens a session with a draft's
// first picture ask, then moves the draft into it. The move is one UPDATE … FROM threads that only
// matches a draft with no home and a conversation in the draft's own room, so only Postgres can
// prove it. Run via scripts/test-pg.sh. It skips without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const DEV = 'c0000000-0000-0000-0000-00000000000b';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const plume: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000003', role: 'marketer' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function post(path: string, actor: Actor, body: unknown) {
  return app!.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

/** a session born the way a tab births one: a message carrying a fresh thread id */
async function session(channel: string): Promise<string> {
  const threadId = randomUUID();
  const r = await post('/v1/messages', george, { workspace: WS, channel, threadId, body: 'Generate the image for “a post”\n\n‹gen-image:00000000›' });
  expect(r.status).toBe(200);
  return threadId;
}

async function threadOf(itemId: string): Promise<string | null> {
  const sql = postgres(DB!);
  try {
    const [row] = await sql<Array<{ thread_id: string | null }>>`select thread_id from content_items where id = ${itemId}::uuid`;
    return row?.thread_id ?? null;
  } finally {
    await sql.end();
  }
}

afterAll(async () => {
  await store?.close();
});

describe.skipIf(!DB)('content.anchor gives a draft with no home one conversation, once', () => {
  it('moves the draft into a session in its room, and never moves it again', async () => {
    const { itemId } = await j(await post('/v1/commands', george, { type: 'content.create', channel: DEV, platform: 'x', body: 'a schedule draft with no home' }));
    const first = await session('dev');
    expect((await post('/v1/commands', plume, { type: 'content.anchor', item: itemId, thread: first })).status).toBe(403);
    expect((await post('/v1/commands', george, { type: 'content.anchor', item: itemId, thread: first })).status).toBe(200);
    expect(await threadOf(itemId)).toBe(first);
    expect((await post('/v1/commands', george, { type: 'content.anchor', item: itemId, thread: await session('dev') })).status).toBe(404);
    expect(await threadOf(itemId)).toBe(first);
  });

  it('refuses a conversation in another room, and a draft that rides a task', async () => {
    const { itemId } = await j(await post('/v1/commands', george, { type: 'content.create', channel: DEV, platform: 'x', body: 'another draft with no home' }));
    expect((await post('/v1/commands', george, { type: 'content.anchor', item: itemId, thread: await session('general') })).status).toBe(404);
    expect(await threadOf(itemId)).toBeNull();

    const { task } = await j(await post('/v1/commands', george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'Launch posts', kind: 'content' }));
    const onTask = await j(await post('/v1/commands', george, { type: 'content.create', channel: DEV, task: task.id, platform: 'x', body: 'a task draft' }));
    expect((await post('/v1/commands', george, { type: 'content.anchor', item: onTask.itemId, thread: await session('dev') })).status).toBe(404);
    expect(await threadOf(onTask.itemId)).toBeNull();
  });
});
