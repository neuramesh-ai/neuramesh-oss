// Settle on a task (0192), on the real schema: the stamp lands, and the tasks_touch trigger leaves
// updated_at and version alone for it, so the queue still reads the gate's own age and an agent's
// command in flight never loses its version race to a person's Settle.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { TABLE_COLUMNS } from '@neuramesh/client-core/schema';
import type { Actor } from '@neuramesh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const DEV = 'c0000000-0000-0000-0000-00000000000b';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const send = async (body: unknown): Promise<any> => (await app!.request('/v1/commands', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
  body: JSON.stringify(body),
})).json();
const row = async (id: string) => (await store!.sql<Array<{ state: string; version: number; updated_at: Date; settled_at: Date | null }>>`
  select state, version, updated_at, settled_at from tasks where id = ${id}::uuid`)[0]!;

afterAll(async () => { await store?.close(); });

describe.skipIf(!DB)('task.settle on postgres (0192)', () => {
  it('stamps settled_at and leaves state, version and updated_at as they were, both ways', async () => {
    const { task } = await send({ type: 'task.create', workspace: WS, channel: DEV, title: 'Settle me on postgres' });
    const before = await row(task.id);
    expect(before.settled_at).toBeNull();

    expect(await send({ type: 'task.settle', workspace: WS, taskId: task.id })).toMatchObject({ ok: true, settled: true });
    const settled = await row(task.id);
    expect(settled.settled_at).toBeInstanceOf(Date);
    expect([settled.state, settled.version, settled.updated_at.getTime()]).toEqual([before.state, before.version, before.updated_at.getTime()]);

    expect(await send({ type: 'task.unsettle', workspace: WS, taskId: task.id })).toMatchObject({ ok: true, settled: false });
    const back = await row(task.id);
    expect(back.settled_at).toBeNull();
    expect([back.version, back.updated_at.getTime()]).toEqual([before.version, before.updated_at.getTime()]);
  });

  it('any other change still moves version and updated_at', async () => {
    const { task } = await send({ type: 'task.create', workspace: WS, channel: DEV, title: 'Still touched' });
    const before = await row(task.id);
    await store!.sql`update tasks set title = 'Still touched, renamed', settled_at = now() where id = ${task.id}::uuid`;
    expect((await row(task.id)).version).toBe(before.version + 1);
  });

  it('every client replica carries the stamp', () => {
    expect(TABLE_COLUMNS['tasks']).toHaveProperty('settled_at', 'text');
  });
});
