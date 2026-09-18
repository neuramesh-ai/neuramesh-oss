// Routines are HANDS-OFF (2026-08-19, founder report): a task born from an automation's thread
// runs with no human in the loop — plan auto-approved at birth, subtasks minted at create,
// auto-accept when review lands it done, one "finished" push. And the plan is a DOCUMENT for
// every plan-first unit: implementation-plan-v1.md + a thread message naming it, at birth.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const plume: Actor = { kind: 'agent', id: 'a-plume', role: 'marketer' };
const scout: Actor = { kind: 'agent', id: 'a-scout', role: 'reviewer' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };
const PLAN = { legs: ['build'], subtasks: [], approach: 'Sweep the connected X data source, rank posts by verified metrics, deliver a linked report with observations and next actions.' };

const send = (actor: Actor, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

const cmd = (actor: Actor, body: unknown) =>
  app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

/** a routine's thread: the schedule fires a message stamped with scheduleId (0119) */
async function routineThread(): Promise<string> {
  const threadId = crypto.randomUUID();
  await send(george, { ...base, threadId, scheduleId: crypto.randomUUID(), body: '⏱ **Routine — X audit**\n\nAudit the account and reply opportunities.' });
  return threadId;
}

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  // the room's crew — offers resolve by name, claims need a registered seat
  await cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'plume', role: 'marketer', channels: ['dev'] });
  await cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'scout', role: 'reviewer', channels: ['dev'] });
});

describe('a routine-born unit is hands-off end to end', () => {
  it('is born with its plan APPROVED — no gate, no "plan ready" ask', async () => {
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Audit X performance', description: 'weekly audit', kind: 'research', plan: PLAN, originThread: threadId, offerTo: 'plume' }));
    expect(r.task.state).toBe('plan_review');
    expect(r.task.planApprovedAt).toBeTruthy();
    expect(r.task.requirementsConfirmed).toBe(true);
    const created = r.events.find((e: any) => e.type === 'task.created');
    expect(created.payload.routine).toBe(true);
  });

  it('mints the plan\'s subtasks at CREATE — approval never comes', async () => {
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Audit with legs', description: 'x', kind: 'research', plan: { ...PLAN, subtasks: ['collect metrics', 'rank conversations'] }, originThread: threadId }));
    const subs = [...store.tasks.values()].filter((t) => t.parentTaskId === r.task.id);
    expect(subs.map((s) => s.title).sort()).toEqual(['collect metrics', 'rank conversations']);
  });

  it('auto-accepts when review lands it done, with the routine-stamped accepted event', async () => {
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Audit to the end', description: 'x', kind: 'research', plan: PLAN, originThread: threadId, offerTo: 'plume' }));
    await cmd(plume, { type: 'task.claim', taskId: r.task.id });
    await cmd(plume, { type: 'task.submit', taskId: r.task.id, artifacts: [{ kind: 'doc', name: 'result.md', content: '# findings' }] });
    const done = await j(await cmd(scout, { type: 'task.approve', taskId: r.task.id }));
    expect(done.task.state).toBe('accepted');
    const acc = done.events.find((e: any) => e.type === 'task.accepted');
    expect(acc.payload.routine).toBe(true);
    expect(acc.source).toContain('machine');
  });

  it('a repo-backed task NEVER auto-accepts, routine or not — code merges on a human signature', async () => {
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Repo work from a routine', description: 'x', kind: 'chore', plan: { ...PLAN, legs: ['build', 'review'] }, originThread: threadId, repo: { id: 'r1', baseRef: 'main' } }));
    // the repo floor keeps even the BIRTH gate: plan not auto-approved
    expect(r.task.planApprovedAt).toBeNull();
  });

  it('a HUMAN conversation still gets the full gate — nothing changed outside routines', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'please track this work' });
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Human-gated work', description: 'x', kind: 'research', plan: PLAN, originThread: threadId }));
    expect(r.task.planApprovedAt).toBeNull();
    expect(r.task.state).toBe('plan_review');
  });

  // The board-born route (2026-08-22, founder report: a routine unit parked at plan_review
  // waiting for a human who is not in this loop). A plan-less anchored todo that reaches
  // plan_review through request_plan → propose_plan auto-approves at the propose.
  it('a plan proposed on a routine-anchored board todo auto-approves — no parked gate', async () => {
    const threadId = await routineThread();
    const atlas: Actor = { kind: 'agent', id: 'a-atlas', role: 'architect' };
    await cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'atlas', role: 'architect', channels: ['dev'] });
    const t = await j(await cmd(george, { type: 'task.create', ...base, title: 'Routine follow-up audit', description: 'x', kind: 'research', originThread: threadId }));
    expect(t.task.planApprovedAt ?? null).toBeNull(); // plan-less birth: nothing to approve yet
    await cmd(rex, { type: 'task.request_plan', taskId: t.task.id, architect: 'atlas', kind: 'research' });
    const p = await j(await cmd(atlas, { type: 'task.propose_plan', taskId: t.task.id, plan: '# Plan\n\naudit and report.', legs: ['build'] }));
    expect(p.task.state).toBe('plan_review');
    expect(p.task.planApprovedAt).toBeTruthy();
    const approved = p.events.find((e: any) => e.type === 'task.plan_approved');
    expect(approved.payload.routine).toBe(true);
    expect(approved.source).toContain('machine');
  });

  it('the same board route in a HUMAN conversation still parks for approval', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'please plan this' });
    const atlas: Actor = { kind: 'agent', id: 'a-atlas', role: 'architect' };
    await cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'atlas', role: 'architect', channels: ['dev'] });
    const t = await j(await cmd(george, { type: 'task.create', ...base, title: 'Human board todo', description: 'x', kind: 'research', originThread: threadId }));
    await cmd(rex, { type: 'task.request_plan', taskId: t.task.id, architect: 'atlas', kind: 'research' });
    const p = await j(await cmd(atlas, { type: 'task.propose_plan', taskId: t.task.id, plan: '# Plan\n\ndo it.', legs: ['build'] }));
    expect(p.task.state).toBe('plan_review');
    expect(p.task.planApprovedAt ?? null).toBeNull();
  });
});

describe('a playbook run is hands-off too (round 3 — the ask is the consent)', () => {
  it('born APPROVED in a plain human conversation — no routine thread required', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'run the audit on our site' });
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Website audit — acme.dev', description: 'Playbook: audit', kind: 'research', plan: PLAN, playbook: 'audit', originThread: threadId, offerTo: 'plume' }));
    expect(r.task.state).toBe('plan_review');
    expect(r.task.planApprovedAt).toBeTruthy();
    expect(r.task.requirementsConfirmed).toBe(true);
    const created = r.events.find((e: any) => e.type === 'task.created');
    expect(created.payload.playbook).toBe('audit');
  });

  it('declared subtasks mint at CREATE — approval never comes for a canned template', async () => {
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Launch plan — v1', description: 'x', kind: 'content', plan: { ...PLAN, subtasks: ['landing copy', 'demo script'] }, playbook: 'launch' }));
    const subs = [...store.tasks.values()].filter((t) => t.parentTaskId === r.task.id);
    expect(subs.map((s) => s.title).sort()).toEqual(['demo script', 'landing copy']);
  });

  it('runs lean to the ACCEPT gate — the human settles it, never an auto-accept', async () => {
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Site audit to done', description: 'x', kind: 'research', plan: PLAN, playbook: 'audit', offerTo: 'plume' }));
    await cmd(plume, { type: 'task.claim', taskId: r.task.id });
    const fin = await j(await cmd(plume, { type: 'task.finish_subtask', taskId: r.task.id, note: 'report attached', artifacts: [{ kind: 'doc', name: 'audit-report-2026-08-21.md', content: '# audit' }] }));
    expect(fin.task.state).toBe('done'); // resting at the accept gate — no routine auto-accept fires here
  });

  it('the repo floor holds — a repo-backed create ignores the playbook field', async () => {
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Repo playbook?', description: 'x', kind: 'chore', plan: { ...PLAN, legs: ['build', 'review'] }, playbook: 'audit', repo: { id: 'r1', baseRef: 'main' } }));
    expect(r.task.planApprovedAt).toBeNull();
  });
});

describe('the plan is a document at birth (every plan-first unit)', () => {
  it('materializes implementation-plan-v1.md and posts the thread message naming it', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'track this' });
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Documented plan', description: 'x', kind: 'research', plan: PLAN, originThread: threadId }));
    const arts = await store.listArtifacts(r.task.id);
    const plan = arts.find((a) => a.name === 'implementation-plan-v1.md');
    expect(plan).toBeTruthy();
    expect(plan!.kind).toBe('doc');
    expect(plan!.content).toContain('# Implementation plan · v1');
    expect(plan!.content).toContain('research'); // the execution leg named honestly
    const msgs = store.messages.filter((m) => m.taskId === r.task.id);
    expect(msgs.some((m) => m.body.includes('implementation-plan-v1.md'))).toBe(true);
    // the ‹plan:vN› marker is what renders the thread-native review card
    expect(msgs.some((m) => m.body.includes('‹plan:v1›'))).toBe(true);
  });

  it('a revision lands as v2 — the birth doc claimed v1', async () => {
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'track this' });
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Versioned plans', description: 'x', kind: 'feature', plan: PLAN, originThread: threadId }));
    await cmd(george, { type: 'task.revise_plan', taskId: r.task.id, feedback: 'tighter scope please' });
    await cmd(rex, { type: 'task.propose_plan', taskId: r.task.id, plan: 'v2 approach: narrower.', legs: ['build'], subtasks: [] });
    const names = (await store.listArtifacts(r.task.id)).map((a) => a.name);
    expect(names).toContain('implementation-plan-v1.md');
    expect(names).toContain('implementation-plan-v2.md');
  });
});

// The DESIGN gate (2026-09-16, founder report on #1093: a routine-born content unit declared a
// design leg, so even an anchored, plan-approved unit would have parked at design_review — the
// one human gate with no routine follow-up). A routine's design round auto-approves at the propose.
describe('a routine-born unit is hands-off through the design gate too', () => {
  const iris: Actor = { kind: 'agent', id: 'a-iris', role: 'designer' };
  const DESIGN_PLAN = { legs: ['design', 'build'], subtasks: [], approach: 'Research the week, agree three image directions, then draft the seven posts to them.' };
  const seatIris = () => cmd(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'iris', role: 'designer', channels: ['dev'] });

  it('the round auto-approves: todo (the plan-first fork), the round promoted, the routine-stamped event, one thread line', async () => {
    await seatIris();
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Draft the X calendar', description: 'x', kind: 'content', plan: DESIGN_PLAN, originThread: threadId }));
    expect(r.task.planApprovedAt).toBeTruthy();
    expect((await cmd(rex, { type: 'task.request_design', taskId: r.task.id, designer: 'iris' })).status).toBe(200);
    const p = await j(await cmd(iris, { type: 'task.propose_design', taskId: r.task.id, round: 1, mockups: [{ name: 'breath', html: '<b>a</b>' }, { name: 'desk', html: '<b>b</b>' }] }));
    expect(p.task.state).toBe('todo');
    expect(p.task.assignee).toBeNull();
    const approved = p.events.find((e: any) => e.type === 'task.design_approved');
    expect(approved.payload.routine).toBe(true);
    expect(approved.payload.round).toBe(1);
    expect(approved.source).toContain('machine');
    const arts = await store.listArtifacts(r.task.id);
    expect(arts.filter((a) => a.kind === 'design').every((a) => a.promoted)).toBe(true);
    const line = store.messages.find((m) => m.taskId === r.task.id && m.body.includes('Design round 1 auto-approved'));
    expect(line).toBeTruthy();
    expect(line!.author.id).toBe('a-rex'); // the unit's creator speaks, the way the plan message does
  });

  it('a HUMAN conversation\'s design round still parks for the human', async () => {
    await seatIris();
    const threadId = crypto.randomUUID();
    await send(george, { ...base, threadId, body: 'please make the calendar' });
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Human calendar', description: 'x', kind: 'content', plan: DESIGN_PLAN, originThread: threadId }));
    expect((await cmd(george, { type: 'task.approve_plan', taskId: r.task.id })).status).toBe(200);
    expect((await cmd(rex, { type: 'task.request_design', taskId: r.task.id, designer: 'iris' })).status).toBe(200);
    const p = await j(await cmd(iris, { type: 'task.propose_design', taskId: r.task.id, round: 1, mockups: [{ name: 'a', html: '<b>a</b>' }] }));
    expect(p.task.state).toBe('design_review');
    expect(p.events.some((e: any) => e.type === 'task.design_approved')).toBe(false);
  });

  it('the repo floor holds: a repo-backed routine unit keeps the human design gate', async () => {
    await seatIris();
    const threadId = await routineThread();
    const r = await j(await cmd(rex, { type: 'task.create', ...base, title: 'Repo design from a routine', description: 'x', kind: 'feature', plan: { ...DESIGN_PLAN, legs: ['design', 'build', 'review'] }, originThread: threadId, repo: { id: 'r1', baseRef: 'main' } }));
    expect(r.task.planApprovedAt).toBeNull(); // the birth gate already holds for repo work
    expect((await cmd(george, { type: 'task.approve_plan', taskId: r.task.id })).status).toBe(200);
    expect((await cmd(rex, { type: 'task.request_design', taskId: r.task.id, designer: 'iris' })).status).toBe(200);
    const p = await j(await cmd(iris, { type: 'task.propose_design', taskId: r.task.id, round: 1, mockups: [{ name: 'a', html: '<b>a</b>' }] }));
    expect(p.task.state).toBe('design_review');
  });
});
