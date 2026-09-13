// Duplicate-create guard (handler createTask): two agent turns racing one request must
// not BOTH create the task. The incident this enforces against (#1015/#1016, 2026-07-14):
// a message-wake triage and the monitor self-check each created "Add auto-update feature
// to Flowe desktop app with update card" 27 seconds apart, and the second copy routed
// around the design gate. The server now refuses the agent's second create (409
// DUPLICATE_TASK) and names the surviving task so the refused turn acts on it instead.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

const TITLE = 'Add auto-update feature to Flowe desktop app with update card';

function create(actor: Actor, extra: Record<string, unknown> = {}) {
  // plan-first (docs/41): an agent's live create must carry its plan — the stub keeps these
  // tests about the DUPLICATE guard, not the plan floor (plan_review counts as open)
  const plan = actor.kind === 'agent' && !('backlog' in extra) && !('parent' in extra) && !('plan' in extra)
    ? { plan: { legs: ['build'], subtasks: [], approach: 'stub approach for the dedupe fixtures' } }
    : {};
  return send(actor, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: TITLE, ...plan, ...extra });
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('task.create duplicate guard (the #1015/#1016 double-triage)', () => {
  it('refuses an agent re-create of an open same-title task, naming the survivor', async () => {
    const first = (await j(await create(rex))).task;
    const res = await create(rex);
    expect(res.status).toBe(409);
    const body = await j(res);
    expect(body.code).toBe('DUPLICATE_TASK');
    expect(body.error).toContain(`#${first.number}`);
  });

  it('collides on case + whitespace variants (normalized titles)', async () => {
    await create(rex);
    const res = await create(rex, { title: `  ADD auto-update   feature to flowe DESKTOP app with update card ` });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('DUPLICATE_TASK');
  });

  it('a same-title task in a DIFFERENT channel is not a duplicate', async () => {
    await create(rex);
    const res = await create(rex, { channel: 'design' });
    expect(res.status).toBe(200);
  });

  it('humans bypass — a deliberate same-title re-create is their call', async () => {
    await create(rex);
    const res = await create(george);
    expect(res.status).toBe(200);
  });

  it('backlog parks bypass in both directions', async () => {
    // an open live task never blocks parking the same idea…
    await create(rex);
    const parked = await create(patch, { backlog: true });
    expect(parked.status).toBe(200);
    // …and a parked same-title idea never blocks creating the live task
    store = new MemoryStore();
    app = createApp(store);
    await create(patch, { backlog: true });
    const live = await create(rex);
    expect(live.status).toBe(200);
  });

  it('an accepted/closed sibling does not block a re-create', async () => {
    const first = (await j(await create(rex))).task;
    await store.mutate(first.id, async (t) => ({ task: { ...t, state: 'accepted' }, events: [] }));
    const res = await create(rex);
    expect(res.status).toBe(200);
  });

  // This test used to assert the opposite — that an open sibling older than an hour does NOT
  // block — and the live app showed what that bought: #1020 sat in design_review for two hours,
  // its owning turn resumed, and the same request was created again as #1021. The age bound is
  // gone; OPEN is the whole condition, and a long-lived task is exactly the one worth protecting.
  it('an open sibling blocks at ANY age — the guard is open-scoped, not time-scoped', async () => {
    const first = (await j(await create(rex))).task;
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    await store.mutate(first.id, async (t) => ({ task: { ...t, createdAt: twoHoursAgo }, events: [] }));
    const res = await create(rex);
    expect(res.status).toBe(409);
    const body = await j(res);
    expect(body.code).toBe('DUPLICATE_TASK');
    expect(body.error).toContain(`#${first.number}`);   // the 409 names the survivor to act on
  });

  // the recurring-chore case the window was there to protect: a CLOSED predecessor never blocks,
  // which is why removing the age bound costs nothing.
  it('a closed sibling never blocks, however recent', async () => {
    const first = (await j(await create(rex))).task;
    await store.mutate(first.id, async (t) => ({ task: { ...t, state: 'closed' }, events: [] }));
    expect((await create(rex)).status).toBe(200);
  });
});
