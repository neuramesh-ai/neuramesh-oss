import type { Actor } from '@neuramesh/shared';
import type { NMMessage } from '../src/store/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// Plan-first units + thread-owned work (2026-08-17), end to end over HTTP:
// a create carrying `plan` is BORN in plan_review with its work plan attached and its
// ‹task:id› unit card posted into the owning conversation; the HUMAN's approve_plan
// releases it to its declared legs (claim for build-first, request_design for design-first,
// the approve_design fork back to todo) and MINTS the proposed subtasks; review cannot be
// declared away for repo-backed work; a lean unit (no review leg) finishes to the accept
// gate; a re-proposed plan always clears the prior approval.

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };
const iris: Actor = { kind: 'agent', id: 'iris', role: 'designer' };

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

const ORIGIN = '5b1f0d3e-8f2a-4c6e-9d17-2a9b64c7e001';

function createPlanned(extra: Record<string, unknown> = {}, actor: Actor = rex) {
  return send(actor, {
    type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev',
    title: 'pricing tiers redesign', kind: 'feature', originThread: ORIGIN,
    plan: { legs: ['build', 'review'], subtasks: [], approach: '## Approach\nrestyle the tier cards.' },
    ...extra,
  });
}

const cardsIn = (threadId: string): NMMessage[] =>
  (store as unknown as { messages: NMMessage[] }).messages.filter((m) => m.threadId === threadId && m.body.includes('‹task:'));

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('plan-first units', () => {
  it('a create carrying a plan is born in plan_review, anchored to its conversation, with the unit card posted', async () => {
    const res = await createPlanned();
    expect(res.status).toBe(200);
    const t = (await j(res)).task;
    expect(t.state).toBe('plan_review');
    expect(t.workPlan.legs).toEqual(['build', 'review']);
    expect(t.workPlan.version).toBe(1);
    expect(t.planApprovedAt).toBeNull();
    expect(t.originThreadId).toBe(ORIGIN);
    const cards = cardsIn(ORIGIN);
    expect(cards.length).toBe(1);
    expect(cards[0]!.body).toBe(`‹task:${t.id}›`);
    expect(cards[0]!.taskId).toBeNull(); // a conversation message, not a task-scoped one
  });

  it('repo-backed work cannot declare review away — the floor, not a prompt', async () => {
    const res = await createPlanned({ repo: { id: 'acme/site', baseRef: 'main' }, plan: { legs: ['build'], subtasks: [], approach: 'x' } });
    expect(res.status).toBe(422);
    expect((await j(res)).error).toMatch(/declare review away/);
  });

  it('journey legs follow the causal order and build is always present', async () => {
    expect((await createPlanned({ plan: { legs: ['review', 'build'], subtasks: [], approach: 'x' } })).status).toBe(422);
    expect((await createPlanned({ plan: { legs: ['design', 'review'], subtasks: [], approach: 'x' } })).status).toBe(422);
  });

  it('nothing is built from an unapproved plan; the human approve releases the claim', async () => {
    const t = (await j(await createPlanned())).task;
    const early = await send(patch, { type: 'task.claim', taskId: t.id });
    expect(early.status).toBe(422);
    expect((await j(early)).code).toBe('PLAN_NOT_APPROVED');
    expect((await send(george, { type: 'task.approve_plan', taskId: t.id })).status).toBe(200);
    const claim = await send(patch, { type: 'task.claim', taskId: t.id });
    expect(claim.status).toBe(200);
    expect((await j(claim)).task.state).toBe('in_progress');
  });

  it('agents cannot approve the plan — the gate is the human, structurally', async () => {
    const t = (await j(await createPlanned())).task;
    const res = await send(rex, { type: 'task.approve_plan', taskId: t.id });
    expect(res.status).toBe(403);
  });

  it('design-first: approval routes to designing, and the approve_design fork returns to todo (the plan already exists)', async () => {
    const t = (await j(await createPlanned({ plan: { legs: ['design', 'build', 'review'], subtasks: [], approach: 'x' } }))).task;
    const early = await send(rex, { type: 'task.request_design', taskId: t.id, designer: 'iris' });
    expect(early.status).toBe(422); // PLAN_NOT_APPROVED — the declared leg still waits for the human
    expect((await send(george, { type: 'task.approve_plan', taskId: t.id })).status).toBe(200);
    expect((await send(rex, { type: 'task.request_design', taskId: t.id, designer: 'iris' })).status).toBe(200);
    expect((await send(iris, { type: 'task.propose_design', taskId: t.id, round: 1, mockups: [{ name: 'a.html', html: '<b>a</b>' }] })).status).toBe(200);
    const ok = await send(george, { type: 'task.approve_design', taskId: t.id });
    expect(ok.status).toBe(200);
    expect((await j(ok)).task.state).toBe('todo'); // the fork — never back into planning
  });

  it('the approval MINTS the proposed subtasks, once (a double-click cannot double-mint)', async () => {
    const t = (await j(await createPlanned({ plan: { legs: ['build', 'review'], subtasks: ['spike the css grid', 'audit tier copy'], approach: 'x' } }))).task;
    expect((await send(george, { type: 'task.approve_plan', taskId: t.id })).status).toBe(200);
    expect(await store.subtaskCount(t.id)).toBe(2);
    expect((await send(george, { type: 'task.approve_plan', taskId: t.id })).status).toBe(200); // idempotent
    expect(await store.subtaskCount(t.id)).toBe(2);
  });

  it('a lean unit (no review leg) finishes to the accept gate; a review-carrying unit cannot', async () => {
    const lean = (await j(await createPlanned({ title: 'competitor scan', kind: 'research', plan: { legs: ['build'], subtasks: [], approach: 'x' } }))).task;
    await send(george, { type: 'task.approve_plan', taskId: lean.id });
    await send(patch, { type: 'task.claim', taskId: lean.id });
    const fin = await send(patch, { type: 'task.finish_subtask', taskId: lean.id, note: 'scan attached', artifacts: [{ kind: 'doc', name: 'scan.md', content: '# scan' }] });
    expect(fin.status).toBe(200);
    expect((await j(fin)).task.state).toBe('done'); // resting at the accept gate — the human's word settles it
    expect((await store.listArtifacts(lean.id)).map((a) => a.name)).toContain('scan.md'); // deliverables stay on the unit

    const gated = (await j(await createPlanned({ title: 'tiers build' }))).task;
    await send(george, { type: 'task.approve_plan', taskId: gated.id });
    await send(patch, { type: 'task.claim', taskId: gated.id });
    const bad = await send(patch, { type: 'task.finish_subtask', taskId: gated.id, note: 'shortcut', artifacts: [] });
    expect(bad.status).toBeGreaterThanOrEqual(400); // its plan declares review — no shortcut to done
  });

  it('a revised plan is a new plan: re-propose bumps the version, updates the structure, and clears the approval', async () => {
    const t = (await j(await createPlanned())).task;
    await send(george, { type: 'task.approve_plan', taskId: t.id });
    expect((await send(george, { type: 'task.revise_plan', taskId: t.id, feedback: 'narrow it to the tier cards' })).status).toBe(200); // plan_review -> planning
    const re = await send(rex, { type: 'task.propose_plan', taskId: t.id, plan: '## v2\nnarrower.', legs: ['design', 'build', 'review'], subtasks: ['mockup pass'] });
    expect(re.status).toBe(200);
    const t2 = (await j(re)).task;
    expect(t2.state).toBe('plan_review');
    expect(t2.workPlan.version).toBe(2);
    expect(t2.workPlan.legs).toEqual(['design', 'build', 'review']);
    expect(t2.planApprovedAt).toBeNull(); // the human signs the NEW plan
  });

  it('a chat thread cannot own board work — the CHAT_THREAD floor covers the origin anchor', async () => {
    await store.postMessage(
      { id: crypto.randomUUID(), workspace: 'ws_acme', channel: 'dev', taskId: null, threadId: '6c2e1f4a-9b3d-4e7f-8a28-3b0c75d8e002', threadMode: 'chat', author: { kind: 'human', id: 'george' }, body: 'hi', createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: 'message.posted', source: 'human:george', target: 'channel/dev', workspace: 'ws_acme', at: new Date().toISOString(), payload: {} } as never,
    );
    const res = await createPlanned({ originThread: '6c2e1f4a-9b3d-4e7f-8a28-3b0c75d8e002' });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('CHAT_THREAD');
  });

  it('an agent cannot create a live task WITHOUT a plan — the card retired, the floor moved here', async () => {
    const res = await send(rex, {
      type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'quick thing', kind: 'chore',
    });
    expect(res.status).toBe(422);
    expect((await j(res)).error).toMatch(/PLAN_FIRST/);
  });

  it('an offer cannot bind a repo onto a unit whose plan declared review away', async () => {
    const t = (await j(await createPlanned({ title: 'notes cleanup', kind: 'chore', plan: { legs: ['build'], subtasks: [], approach: 'tidy the notes' } }))).task;
    await send(george, { type: 'task.approve_plan', taskId: t.id });
    const res = await send(rex, { type: 'task.offer', taskId: t.id, offerTo: 'patch', checklist: ['tidy'], repo: { id: 'acme/site', baseRef: 'main' } });
    expect(res.status).toBe(422);
    expect((await j(res)).error).toMatch(/no review leg/);
  });

  it('backlog parks ignore the plan — a parked idea has no journey yet', async () => {
    const res = await send(patch, {
      type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'someday: dark charts', backlog: true,
      plan: { legs: ['build'], subtasks: [], approach: 'x' },
    });
    expect(res.status).toBe(200);
    const t = (await j(res)).task;
    expect(t.state).toBe('backlog');
    expect(t.workPlan).toBeNull();
  });
});
