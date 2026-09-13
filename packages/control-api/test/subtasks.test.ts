import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// Subtasks (docs/24), end to end over HTTP: companion work rides its parent —
// created by ANY teammate under an active task, restricted to the lean
// claim → finish → cancel life, artifacts landing on the PARENT, and the parent
// unable to pass submit/accept/ship gates while a subtask is open. Plus the
// shadow-task bounce that closes the #1018 class.

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };
const bosun: Actor = { kind: 'agent', id: 'bosun', role: 'shipper' };

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

async function createParent(extra: Record<string, unknown> = {}) {
  const res = await send(george, {
    type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev',
    title: 'add auto-update card', kind: 'feature',
    repo: { id: 'acme/site', baseRef: 'main' }, ...extra,
  });
  expect(res.status).toBe(200);
  return (await j(res)).task as { id: string; number: number };
}

const addSub = (actor: Actor, parent: string, title: string, extra: Record<string, unknown> = {}) =>
  send(actor, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', title, parent, ...extra });

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('subtasks, end to end', () => {
  it('any teammate creates one under an active parent; claim → finish lands artifacts on the PARENT', async () => {
    const parent = await createParent();
    const res = await addSub(bosun, parent.id, 'Release-readiness pass');
    expect(res.status).toBe(200);
    const sub = (await j(res)).task;
    expect(sub.parentTaskId).toBe(parent.id);
    expect(sub.state).toBe('todo');

    expect((await send(patch, { type: 'task.claim', taskId: sub.id })).status).toBe(200);
    const fin = await send(patch, {
      type: 'task.finish_subtask', taskId: sub.id, note: 'pass attached',
      artifacts: [{ kind: 'doc', name: 'readiness-pass.md', content: '# ok' }],
    });
    expect(fin.status).toBe(200);
    expect((await j(fin)).task.state).toBe('done');

    const detail = await app.request(`/v1/tasks/${parent.id}`, { headers: { 'x-nm-actor': JSON.stringify(george) } });
    const { artifacts } = await j(detail);
    expect(artifacts.map((a: { name: string }) => a.name)).toContain('readiness-pass.md');
  });

  it('the boss check-off: a human finishes an unclaimed subtask straight from todo', async () => {
    const parent = await createParent();
    const sub = (await j(await addSub(rex, parent.id, 'cross-check permissions'))).task;
    const fin = await send(george, { type: 'task.finish_subtask', taskId: sub.id });
    expect(fin.status).toBe(200);
    expect((await j(fin)).task.state).toBe('done');
  });

  it('a parent cannot submit / accept with open subtasks — and can once they finish', async () => {
    const parent = await createParent();
    expect((await send(patch, { type: 'task.claim', taskId: parent.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.confirm_requirements', taskId: parent.id, checklist: ['scope'] })).status).toBe(200);
    const sub = (await j(await addSub(patch, parent.id, 'doc note for the change'))).task;

    const submit = await send(patch, { type: 'task.submit', taskId: parent.id, artifacts: [{ kind: 'diff', name: 'x.diff' }], sha: 'abc1234' });
    expect(submit.status).toBe(422);
    expect((await j(submit)).code).toBe('SUBTASKS_PENDING');

    expect((await send(george, { type: 'task.finish_subtask', taskId: sub.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: parent.id, artifacts: [{ kind: 'diff', name: 'x.diff' }], sha: 'abc1234' })).status).toBe(200);

    // …and the accept gate: a fresh subtask created during review re-arms it
    expect((await send(gem, { type: 'task.approve', taskId: parent.id })).status).toBe(200);
    const late = (await j(await addSub(rex, parent.id, 'late-found cleanup'))).task;
    const accept = await send(george, { type: 'task.accept', taskId: parent.id });
    expect(accept.status).toBe(422);
    expect((await j(accept)).code).toBe('SUBTASKS_PENDING');
    expect((await send(george, { type: 'task.cancel', taskId: late.id })).status).toBe(200); // the relief valve
    expect((await send(george, { type: 'task.accept', taskId: parent.id })).status).toBe(200);
  });

  it('structurally minor: no nesting, cap 8, same channel, no repo, active parent only', async () => {
    const parent = await createParent();
    const sub = (await j(await addSub(rex, parent.id, 'level one'))).task;
    expect((await addSub(rex, sub.id, 'level two')).status).toBe(422); // no nesting
    expect((await addSub(rex, parent.id, 'with repo', { repo: { id: 'acme/site', baseRef: 'main' } })).status).toBe(422);
    // channel is INHERITED by construction — a caller naming the wrong room still lands in the parent's
    const wrongRoom = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'general', project: 'general', title: 'wrong room named', parent: parent.id });
    expect(wrongRoom.status).toBe(200);
    expect((await j(wrongRoom)).task.channel).toBe('dev');
    // 'level one' + the inherited wrong-room one = 2 live; six fillers reach the cap
    for (let i = 0; i < 6; i++) expect((await addSub(rex, parent.id, `filler ${i}`)).status).toBe(200);
    expect((await addSub(rex, parent.id, 'ninth')).status).toBe(422); // cap 8

    const parked = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', title: 'parked idea', backlog: true });
    expect((await addSub(rex, (await j(parked)).task.id, 'under a parked idea')).status).toBe(422);
  });

  it('a subtask has no ceremonies — offer/claim/finish/cancel only', async () => {
    const parent = await createParent();
    const sub = (await j(await addSub(rex, parent.id, 'lean life'))).task;
    expect((await send(rex, { type: 'task.request_plan', taskId: sub.id, kind: 'chore' })).status).toBe(403);
    expect((await send(patch, { type: 'task.claim', taskId: sub.id })).status).toBe(200);
    expect((await send(patch, { type: 'task.submit', taskId: sub.id, artifacts: [{ kind: 'doc', name: 'n.md' }] })).status).toBe(403);
    // a PARENT never finishes — review is its road to done
    expect((await send(patch, { type: 'task.claim', taskId: parent.id })).status).toBe(200);
    expect((await send(george, { type: 'task.finish_subtask', taskId: parent.id })).status).toBe(403);
  });

  it('the shadow-task bounce: an agent peer-task naming an open task gets MAKE_IT_A_SUBTASK', async () => {
    const parent = await createParent();
    const shadow = await send(rex, {
      type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', kind: 'chore',
      title: `Release-readiness pass for #${parent.number}`,
      // the bounce is judged BEFORE the plan-first floor — its error carries the fix
      plan: { legs: ['build'], subtasks: [], approach: 'stub approach — the bounce should fire first' },
    });
    expect(shadow.status).toBe(409);
    expect((await j(shadow)).code).toBe('MAKE_IT_A_SUBTASK');
    // humans bypass (a deliberate cross-reference is their call)…
    expect((await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', title: `follow-up to #${parent.number}` })).status).toBe(200);
    // …and backlog parks stay frictionless
    expect((await send(patch, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', title: `idea sparked by #${parent.number}`, backlog: true })).status).toBe(200);
  });
});
