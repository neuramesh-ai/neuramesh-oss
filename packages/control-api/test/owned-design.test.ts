// An OWNED design round (docs/29 §4d). The orchestrator owns the whole deliverable, and a design
// phase is a leg of that flow — not a handoff. The server rule this rests on is narrow: only a
// request_design that CARRIES a `designer` reassigns the task. Omit it and ownership survives.
//
// This is a regression guard with a live failure behind it. The daemon's request_design tool used to
// resolve the seated designer unconditionally and always send `designer:`, so a task rex had just
// taken was reassigned to iris by the very next call — take_task looked like it worked and ownership
// was gone one command later. Board state on the running app said assignee=iris, state=designing.
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

let seq = 0;
// take = offer-to-self + claim, the same two enforced commands a hand-off uses (agents.ts take_task)
async function taken() {
  const t = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: `a visual request ${++seq}`, kind: 'feature' }))).task;
  expect((await send(rex, { type: 'task.offer', taskId: t.id, offerTo: 'rex', checklist: ['two tiers', 'annual toggle'] })).status).toBe(200);
  const claimed = await send(rex, { type: 'task.claim', taskId: t.id });
  expect(claimed.status).toBe(200);
  expect((await j(claimed)).task).toMatchObject({ state: 'in_progress' });
  return t;
}

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'rex', role: 'orchestrator', channels: ['dev'] });
  await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'iris', role: 'designer', channels: ['dev'] });
});

describe('an owned design round keeps its owner (docs/29 §4d)', () => {
  it('request_design WITHOUT a designer moves the phase and leaves the task with rex', async () => {
    const t = await taken();
    const res = await send(rex, { type: 'task.request_design', taskId: t.id, kind: 'feature' });
    expect(res.status).toBe(200);
    const task = (await j(res)).task;
    expect(task.state).toBe('designing');
    // the assertion the live bug violated: the phase moved, the owner did not change
    expect(task.assignee).toMatchObject({ id: 'rex' });
  });

  it('request_design WITH a designer still hands the task over — delegation stays legal', async () => {
    const t = await taken();
    const task = (await j(await send(rex, { type: 'task.request_design', taskId: t.id, designer: 'iris', kind: 'feature' }))).task;
    expect(task.state).toBe('designing');
    expect(task.assignee).toMatchObject({ id: 'iris' });
  });

  it('the owner can propose the round it drew, and still cannot approve it', async () => {
    const t = await taken();
    await send(rex, { type: 'task.request_design', taskId: t.id, kind: 'feature' });
    const proposed = await send(rex, { type: 'task.propose_design', taskId: t.id, mockups: [{ name: 'pricing-a.html', html: '<!doctype html><h1>Pricing A</h1>' }] });
    expect(proposed.status).toBe(200);
    expect((await j(proposed)).task.state).toBe('design_review');
    // approval is the human's, whoever drew it — ownership buys no self-approval
    const selfApprove = await send(rex, { type: 'task.approve_design', taskId: t.id });
    expect(selfApprove.status).toBeGreaterThanOrEqual(400);
  });
});
