// A verdict closes the task's older question cards, on the real schema (the needs-you round, 2026-11-23):
// the store's one UPDATE dismisses the open nmq cards and keeps a permission card (requires_exact_answer).
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
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
  method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify(body),
})).json();

afterAll(async () => { await store?.close(); });

describe.skipIf(!DB)('a verdict closes question cards on postgres', () => {
  it('a plan approval dismisses the open question and keeps the permission card', async () => {
    const { task } = await send({ type: 'task.create', workspace: WS, channel: DEV, title: 'Verdict cards on postgres', plan: { legs: ['build'], subtasks: [], approach: 'x' } });
    const msg = (await store!.sql<Array<{ id: string }>>`insert into messages (workspace_id, channel_id, task_id, author_kind, author_id, body)
      values (${WS}::uuid, ${DEV}::uuid, ${task.id}::uuid, 'human', ${george.id}::uuid, 'cards') returning id`)[0]!;
    for (const [q, exact] of [['What verdict on the plan?', false], ['Allow git push?', true]] as const) {
      await store!.sql`insert into decisions (workspace_id, channel_id, task_id, message_id, asker_kind, asker_id, question, options, allow_other, requires_exact_answer)
        values (${WS}::uuid, ${DEV}::uuid, ${task.id}::uuid, ${msg.id}::uuid, 'human', ${george.id}::uuid, ${q}, '[]'::jsonb, true, ${exact})`;
    }
    const out = await send({ type: 'task.approve_plan', taskId: task.id });
    expect(out.task?.planApprovedAt ?? out.planApprovedAt).toBeTruthy();
    const rows = await store!.sql<Array<{ question: string; status: string }>>`select question, status from decisions where task_id = ${task.id}::uuid order by question`;
    expect(rows.map((r) => [r.question, r.status])).toEqual([['Allow git push?', 'open'], ['What verdict on the plan?', 'dismissed']]);
  });
});
