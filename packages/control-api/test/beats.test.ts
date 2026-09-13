// Beats (docs/17): the working agent declares an ordered set of steps for the phase it picked
// up, then advances them live. The server gates on the agent's role owning the current phase and
// stamps started/done times; beats are DESCRIPTIVE — they never gate an FSM transition.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };
const atlas: Actor = { kind: 'agent', id: 'atlas', role: 'architect' };

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

// a task driven to in_progress with patch (developer) as the working agent
async function inProgressTask() {
  await send(george, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'patch', role: 'developer', channels: ['dev'] });
  const t = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'fix the crash', kind: 'bug', offerTo: 'patch', checklist: ['repro'] }))).task;
  expect((await send(patch, { type: 'task.claim', taskId: t.id })).status).toBe(200); // → in_progress, patch assignee
  return t;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('beats: declare + advance (docs/17)', () => {
  it('the working developer declares an ordered set (all pending, tagged with its role)', async () => {
    const t = await inProgressTask();
    const decl = await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['reproduce the crash', 'fix the root cause', 'add a regression test'] });
    expect(decl.status).toBe(200);
    const beats = await store.listBeats(t.id);
    expect(beats.map((b) => [b.seq, b.title, b.status])).toEqual([
      [0, 'reproduce the crash', 'pending'],
      [1, 'fix the root cause', 'pending'],
      [2, 'add a regression test', 'pending'],
    ]);
    expect(beats.every((b) => b.role === 'developer' && b.phase === 'in_progress')).toBe(true);
  });

  it('advance moves a beat pending → active → done and stamps the times', async () => {
    const t = await inProgressTask();
    await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['a', 'b', 'c'] });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 0, status: 'active' });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 0, status: 'done' });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 1, status: 'active' });
    const beats = await store.listBeats(t.id);
    expect(beats[0]!.status).toBe('done');
    expect(beats[0]!.doneAt).toBeTruthy();
    expect(beats[1]!.status).toBe('active');
    expect(beats[1]!.startedAt).toBeTruthy();
    expect(beats[2]!.status).toBe('pending');
  });

  it('gates on the agent role owning the phase: humans, non-owning agents, and wrong-phase are refused', async () => {
    const t = await inProgressTask(); // in_progress → owned by developer/worker
    // a human never declares beats
    expect((await send(george, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['x'] })).status).toBe(403);
    // an agent whose role does not own in_progress (the orchestrator) is refused
    expect((await send(rex, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['x'] })).status).toBe(403);
    // declaring for a phase the task is not in → INVALID_INPUT
    const wrong = await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'planning', items: ['x'] });
    expect(wrong.status).toBe(422);
    expect((await j(wrong)).code).toBe('INVALID_INPUT');
  });

  it('each phase is owned by its role — the architect declares planning beats, the developer cannot', async () => {
    const t = (await j(await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'plan the redesign', kind: 'feature' }))).task;
    await send(rex, { type: 'task.request_plan', taskId: t.id, architect: 'atlas', kind: 'feature' }); // → planning
    expect((await send(atlas, { type: 'beats.declare', taskId: t.id, phase: 'planning', items: ['map affected modules', 'draft approach', 'stress-test with critics', 'write the Definition of Done'] })).status).toBe(200);
    expect((await store.listBeats(t.id)).map((b) => b.role)).toEqual(['architect', 'architect', 'architect', 'architect']);
    // a developer may not touch a planning task's beats
    expect((await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'planning', items: ['x'] })).status).toBe(403);
  });

  it('a re-declare opens a NEW run; advance targets the latest run (a re-attempt keeps history)', async () => {
    const t = await inProgressTask();
    await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['first-try a', 'first-try b'] });
    await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['redo a', 'redo b'] });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 0, status: 'done' });
    const all = await store.listBeats(t.id);
    const runs = [...new Set(all.map((b) => b.runId))];
    expect(runs.length).toBe(2); // both sets retained
    const latest = all.filter((b) => b.runId === runs[runs.length - 1]);
    expect(latest[0]!.status).toBe('done'); // advance hit the latest run
    expect(all.filter((b) => b.runId === runs[0]).every((b) => b.status === 'pending')).toBe(true); // the first run is untouched
  });

  it('acceptance settles a still-active beat to done — pending stays honest (the backstop)', async () => {
    // the #1018 class: a flow settles its final beat AFTER its own phase transition, the
    // phase-ownership gate refuses the write, and the beat pulses forever on an accepted
    // task. Acceptance is the strongest "the work completed" signal, so the handler
    // settles ACTIVE beats then; a pending beat honestly never ran and stays pending.
    const scout: Actor = { kind: 'agent', id: 'scout', role: 'reviewer' };
    const t = await inProgressTask();
    await send(patch, { type: 'beats.declare', taskId: t.id, phase: 'in_progress', items: ['fix', 'verify', 'never ran'] });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 0, status: 'done' });
    await send(patch, { type: 'beats.advance', taskId: t.id, seq: 1, status: 'active' });
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: t.id, checklist: ['repro'] })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: t.id, artifacts: [{ kind: 'doc', name: 'fix.md' }] })).status).toBe(200);
    expect((await send(scout, { type: 'task.approve', taskId: t.id })).status).toBe(200);
    expect((await send(george, { type: 'task.accept', taskId: t.id })).status).toBe(200);
    const beats = await store.listBeats(t.id);
    expect(beats.map((b) => b.status)).toEqual(['done', 'done', 'pending']);
    expect(beats[1]!.doneAt).toBeTruthy();
  });
});
