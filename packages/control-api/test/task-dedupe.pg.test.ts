// Duplicate-create guard against the REAL schema — proves the pgstore's SQL title
// normalization (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) stays in lockstep
// with normalizeTaskTitle (store.ts), and that the window + open-state filters behave on
// real timestamps. Memory-store branch coverage lives in task-dedupe.test.ts.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: '30000000-0000-0000-0000-000000000003', role: 'worker' };

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

const TITLE = 'Add auto-update feature to Flowe desktop app with update card (pg)';

function create(actor: Actor, extra: Record<string, unknown> = {}) {
  // plan-first (docs/41): an agent's live create must carry its plan — stubbed so these tests
  // stay about the DUPLICATE guard (plan_review counts as open)
  const plan = actor.kind === 'agent' && !('backlog' in extra) && !('parent' in extra) && !('plan' in extra)
    ? { plan: { legs: ['build'], subtasks: [], approach: 'stub approach for the dedupe fixtures' } }
    : {};
  return send(actor, { type: 'task.create', workspace: WS, channel: 'dev', title: TITLE, ...plan, ...extra });
}

afterAll(async () => {
  await store?.close();
  await sql?.end();
});

describe.skipIf(!DB)('task.create duplicate guard (pg — SQL normalization + open-state filter)', () => {
  it('refuses an agent re-create on a case/whitespace title variant, naming the survivor', async () => {
    const first = (await j(await create(rex))).task;
    const res = await create(rex, { title: `  add   AUTO-update feature to flowe desktop app with update card (PG) ` });
    expect(res.status).toBe(409);
    const body = await j(res);
    expect(body.code).toBe('DUPLICATE_TASK');
    expect(body.error).toContain(`#${first.number}`);

    // humans bypass — a deliberate same-title re-create is their call
    expect((await create(george)).status).toBe(200);
  });

  it('a parked same-title backlog item blocks nothing (open-state filter in SQL)', async () => {
    const parked = await send(patch, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v2`, backlog: true });
    expect(parked.status).toBe(200);
    const live = await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v2`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } });
    expect(live.status).toBe(200);
  });

  // The SQL mirror of the memory-store guard: this asserted the OPPOSITE until #1020 sat in
  // design_review for two hours, its owning turn resumed, and the same request was filed again as
  // #1021 because the window had lapsed. The age bound is gone — OPEN is the whole condition, and a
  // long-lived task is exactly the one worth protecting.
  it('an hours-old open sibling still blocks on real timestamps — no age bound', async () => {
    const { task } = await j(await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v3`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } }));
    await sql!`update tasks set created_at = now() - interval '2 hours' where id = ${task.id}::uuid`;
    const res = await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v3`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('DUPLICATE_TASK');
  });

  // the recurring-chore case the window existed to protect — still safe, via the OPEN filter
  it('a closed sibling never blocks, however recent (pg)', async () => {
    const { task } = await j(await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v4`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } }));
    await sql!`update tasks set state = 'closed' where id = ${task.id}::uuid`;
    expect((await send(rex, { type: 'task.create', workspace: WS, channel: 'dev', title: `${TITLE} v4`, plan: { legs: ['build'], subtasks: [], approach: 'stub approach — plan-first fixtures (docs/41)' } })).status).toBe(200);
  });
});
