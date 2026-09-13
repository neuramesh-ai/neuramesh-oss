// Triage: the task_kind label (docs/16). The server enforces LABELING (a task can't be
// ROUTED without a kind) and the enum boundary — but NEVER couples kind to route: every
// kind is accepted on every route, because whether a task needs design/plan/direct is the
// orchestrator's per-request judgment, not a function of its kind (docs/16 §5).
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

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

// a task.create with NO kind — the pre-triage state a request would arrive in.
// Titles are unique per call: an agent re-creating an open same-title task inside the
// duplicate window is now refused by design (DUPLICATE_TASK — see task-dedupe.test.ts).
let reqSeq = 0;
async function bareTodo(extra: Record<string, unknown> = {}) {
  const res = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: `a request ${++reqSeq}`, ...extra });
  expect(res.status).toBe(200);
  return (await j(res)).task;
}

async function registerDev(name = 'dev1') {
  await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name, role: 'developer', channels: ['dev'] });
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('triage: task_kind is a required label to route (docs/16)', () => {
  it('request_plan / request_design refuse an unlabeled task, and stamp the kind when given', async () => {
    // request_plan on an unlabeled task → INVALID_INPUT (categorize first)
    const t1 = await bareTodo();
    const noKind = await send(rex, { type: 'task.request_plan', taskId: t1.id, architect: 'atlas' });
    expect(noKind.status).toBe(422);
    expect((await j(noKind)).code).toBe('INVALID_INPUT');
    // with a kind → routes into planning AND the task now carries it
    const okPlan = await send(rex, { type: 'task.request_plan', taskId: t1.id, architect: 'atlas', kind: 'bug' });
    expect(okPlan.status).toBe(200);
    expect((await j(okPlan)).task).toMatchObject({ state: 'planning', kind: 'bug' });

    // request_design mirrors it
    const t2 = await bareTodo();
    expect((await send(rex, { type: 'task.request_design', taskId: t2.id, designer: 'iris' })).status).toBe(422);
    const okDesign = await send(rex, { type: 'task.request_design', taskId: t2.id, designer: 'iris', kind: 'feature' });
    expect((await j(okDesign)).task).toMatchObject({ state: 'designing', kind: 'feature' });
  });

  it('offer refuses an unlabeled offerable task; a NON-offerable one fails on state first (not kind)', async () => {
    await registerDev();
    const t = await bareTodo();
    // offerable (todo) but unlabeled → INVALID_INPUT
    const noKind = await send(rex, { type: 'task.offer', taskId: t.id, offerTo: 'dev1', checklist: ['x'] });
    expect(noKind.status).toBe(422);
    expect((await j(noKind)).code).toBe('INVALID_INPUT');
    // with a kind → offered, task carries it
    const ok = await send(rex, { type: 'task.offer', taskId: t.id, offerTo: 'dev1', checklist: ['x'], kind: 'bug' });
    expect(ok.status).toBe(200);
    const detail = await j(await app.request(`/v1/tasks/${t.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } }));
    expect(detail.task.kind).toBe('bug');

    // a parked backlog item offered (unlabeled) → the STATE error wins (can't offer a parked
    // item at all), not a kind error — categorization isn't the fundamental problem here.
    const parked = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'idea', backlog: true }))).task;
    const parkedOffer = await send(rex, { type: 'task.offer', taskId: parked.id, offerTo: 'dev1', checklist: ['x'] });
    expect(parkedOffer.status).toBe(409);
  });

  it('create-with-offerTo requires a kind (offering at creation IS routing); a bare todo may omit it', async () => {
    await registerDev();
    // offering at creation with no kind → INVALID_INPUT (checked before the offer resolves)
    const noKind = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'fix crash', offerTo: 'dev1', checklist: ['x'] });
    expect(noKind.status).toBe(422);
    expect((await j(noKind)).code).toBe('INVALID_INPUT');
    // with a kind → created + offered + labeled
    const ok = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'fix crash', offerTo: 'dev1', checklist: ['x'], kind: 'bug' });
    expect((await j(ok)).task.kind).toBe('bug');
    // a bare todo (no offer, no routing) may stay unlabeled until triaged
    const bare = await bareTodo();
    expect(bare.kind).toBeNull();
  });
});

describe('triage: kind NEVER gates the route (docs/16 §5 — the review correction)', () => {
  it('every kind is accepted on request_design AND request_plan — a bug/chore can be designed, a design can be planned', async () => {
    // any kind may route to DESIGN — a broken component whose fix is a redesign, etc.
    for (const kind of ['bug', 'chore', 'research', 'spike', 'docs', 'refactor', 'design', 'feature'] as const) {
      const t = await bareTodo({ title: `design-${kind}` });
      const res = await send(rex, { type: 'task.request_design', taskId: t.id, designer: 'iris', kind });
      expect(res.status, `request_design must accept kind=${kind}`).toBe(200);
      expect((await j(res)).task.kind).toBe(kind);
    }
    // any kind may route to PLANNING too — including a `design` kind
    for (const kind of ['bug', 'chore', 'research', 'design', 'feature'] as const) {
      const t = await bareTodo({ title: `plan-${kind}` });
      const res = await send(rex, { type: 'task.request_plan', taskId: t.id, architect: 'atlas', kind });
      expect(res.status, `request_plan must accept kind=${kind}`).toBe(200);
    }
  });

  it('rejects an invalid kind value at the schema boundary (enum-gated, not silently stored)', async () => {
    const t = await bareTodo();
    const bad = await send(rex, { type: 'task.request_plan', taskId: t.id, architect: 'atlas', kind: 'nonsense' });
    expect(bad.status).toBe(400);
  });
});

describe('triage: re-categorization + inheritance', () => {
  it('re-labels a mis-triaged item via update_details while pre-work, frozen once staged', async () => {
    const item = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'rough idea', backlog: true }))).task;
    expect(item.kind).toBeNull();
    // label it (kind-only update is allowed)
    expect((await j(await send(george, { type: 'task.update_details', taskId: item.id, kind: 'bug' }))).task.kind).toBe('bug');
    // still pre-work after promote → re-categorize
    await send(george, { type: 'task.promote', taskId: item.id });
    expect((await j(await send(rex, { type: 'task.update_details', taskId: item.id, kind: 'chore' }))).task.kind).toBe('chore');
    // route it (inherits kind='chore'), then the label freezes like the other details
    await send(rex, { type: 'task.request_plan', taskId: item.id, architect: 'atlas' });
    const frozen = await send(george, { type: 'task.update_details', taskId: item.id, kind: 'bug' });
    expect(frozen.status).toBe(409);
    expect((await j(frozen)).code).toBe('ILLEGAL_TRANSITION');
  });

  it('a task labeled at creation carries its kind through routing without re-passing it', async () => {
    const t = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'labeled up front', kind: 'bug' }))).task;
    expect(t.kind).toBe('bug');
    // request_plan WITHOUT a kind arg inherits the task's existing label (no re-labeling)
    const planned = await send(rex, { type: 'task.request_plan', taskId: t.id, architect: 'atlas' });
    expect(planned.status).toBe(200);
    expect((await j(planned)).task.kind).toBe('bug');
  });
});
