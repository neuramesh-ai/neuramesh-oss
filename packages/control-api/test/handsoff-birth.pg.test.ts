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
