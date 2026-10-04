// The hands-off BIRTH stamp against the REAL schema (marketing-os round 3, found live):
// pgstore's task insert silently dropped plan_approved_at, so every "born approved" unit
// (routine- or playbook-born) was actually born GATED on postgres and parked at plan_review —
// while the memory store, which persists the whole object, kept the tests green. The pg row
// is the only truth that catches this class. Run via scripts/test-pg.sh — skipped without
// DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('hands-off birth persists on postgres', () => {
  it('a playbook unit is born with plan_approved_at SET in the pg row itself', async () => {
    const r = await j(await send(rex, {
      type: 'task.create', workspace: WS, channel: 'dev',
      title: 'pg playbook birth', description: 'x', kind: 'research',
      plan: { legs: ['build'], subtasks: [], approach: 'Study the site and deliver the scored report with fixes written out, honest about gaps.' },
      playbook: 'audit',
    }));
    expect(r.task?.planApprovedAt).toBeTruthy();
    const [row] = await sql!`select plan_approved_at, requirements_confirmed from tasks where id = ${r.task.id}`;
    expect(row!['plan_approved_at']).toBeTruthy();
    expect(row!['requirements_confirmed']).toBe(true);
  });

  // ROUTINE OR CONTENT (George, 2026-09-27, "Guard the routine rules"): the rule is SQL on this store
  // (store/routine-rule.ts), so only postgres proves the join and the jsonb test.
  it('a routine\'s session births a unit past its gate, and a scheduled draft\'s session births it gated', async () => {
    const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
    const room = crypto.randomUUID();
    await sql!`insert into channels (id, workspace_id, slug, topic, kind, project_id)
      select ${room}::uuid, workspace_id, ${`drafts-${room.slice(0, 8)}`}, '', 'marketing', project_id from channels where id = 'c0000000-0000-0000-0000-00000000000b'::uuid`;
    const session = async (payload: Record<string, unknown>) => {
      const scheduleId = crypto.randomUUID();
      await sql!`insert into schedules (id, workspace_id, channel_id, title, cadence, at_time, tz, next_run_at, payload, created_by_kind, created_by)
        values (${scheduleId}::uuid, ${WS}::uuid, ${room}::uuid, 'X audit', 'weekdays', '09:00', 'UTC', now(), ${sql!.json(payload as never)}, 'human', ${george.id})`;
      const threadId = crypto.randomUUID();
      await app!.request('/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: JSON.stringify({ workspace: WS, channel: room, threadId, scheduleId, body: 'Routine · X audit\n\nAudit the account.' }) });
      return { scheduleId, threadId };
    };
    const routine = await session({ prompt: 'x', routine: true });
    const draft = await session({ prompt: 'x' });
    const stringy = await session({ prompt: 'x', routine: 'true' });
    expect(await store!.getThreadRoutineId(WS, routine.threadId)).toBe(routine.scheduleId);
    expect(await store!.getThreadRoutineId(WS, draft.threadId)).toBeNull();
    expect(await store!.getThreadRoutineId(WS, stringy.threadId)).toBeNull(); // only a boolean marks a routine
    const plan = { legs: ['build'], subtasks: [], approach: 'Audit the account and report what the numbers say, with the next three moves written out.' };
    // two titles: an agent's second open task with one title in one room is a DUPLICATE_TASK
    const born = async (threadId: string, title: string) => (await j(await send(rex, { type: 'task.create', workspace: WS, channel: room, title, description: 'x', kind: 'research', plan, originThread: threadId }))).task.id as string;
    const [a] = await sql!`select plan_approved_at from tasks where id = ${await born(routine.threadId, 'pg routine session birth')}`;
    const [b] = await sql!`select plan_approved_at from tasks where id = ${await born(draft.threadId, 'pg draft session birth')}`;
    expect(a!['plan_approved_at']).toBeTruthy();
    expect(b!['plan_approved_at']).toBeNull();
  });

  it('an ordinary planned unit still persists a NULL stamp — the gate is real', async () => {
    const r = await j(await send(rex, {
      type: 'task.create', workspace: WS, channel: 'dev',
      title: 'pg gated birth', description: 'x', kind: 'research',
      plan: { legs: ['build', 'review'], subtasks: [], approach: 'A plan a human must read before anything runs, because nothing selected it but the agent.' },
    }));
    expect(r.task?.planApprovedAt).toBeNull();
    const [row] = await sql!`select plan_approved_at from tasks where id = ${r.task.id}`;
    expect(row!['plan_approved_at']).toBeNull();
  });
});
