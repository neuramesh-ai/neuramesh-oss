// ACCEPT ON THE HUMAN'S WORD (George, 2026-09-08). The Accept button left every surface; a done task
// is accepted when the human SAYS so in its thread and the orchestrator applies it. The server does
// not read minds — what it enforces is the evidence: a HUMAN message, in THIS task's thread, NEWER
// than the review verdict. Without it the old floor holds: HUMAN_ONLY.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };
const WS = 'ws_acme';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const tick = () => new Promise((r) => setTimeout(r, 5));

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
async function say(actor: Actor, taskId: string, body: string) {
  await tick();
  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify({ workspace: WS, channel: 'dev', taskId, body }),
  });
  expect(res.status).toBeLessThan(300);
}
/** a task through review: created, claimed, submitted with evidence, approved by the reviewer → done */
async function throughReview(title: string, beforeApprove?: (taskId: string) => Promise<void>) {
  const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title, kind: 'docs' }));
  expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
  expect((await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['scope agreed'] })).status).toBe(200);
  expect((await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'notes.md' }] })).status).toBe(200);
  if (beforeApprove) await beforeApprove(task.id);
  await tick();
  const ok = await send(gem, { type: 'task.approve', taskId: task.id });
  expect(ok.status).toBe(200);
  expect((await j(ok)).task.state).toBe('done');
  return task as { id: string; number: number };
}

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('accept on the human\'s word', () => {
  it('an agent accept with nobody\'s word stays HUMAN_ONLY', async () => {
    const t = await throughReview('quiet');
    const res = await send(rex, { type: 'task.accept', taskId: t.id });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
    expect((await store.getTask(t.id))?.state).toBe('done');
  });

  it('a human message after the verdict lets the orchestrator accept, and the record names it', async () => {
    const t = await throughReview('merge me');
    await say(george, t.id, 'merge it');
    const res = await send(rex, { type: 'task.accept', taskId: t.id });
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.task.state).toBe('accepted');
    expect(typeof body.onWord?.id).toBe('string');
    expect(typeof body.onWord?.createdAt).toBe('string');
  });

  it('a word spoken BEFORE the verdict does not count — the human must answer the review, not the submission', async () => {
    const t = await throughReview('early word', async (id) => { await say(george, id, 'looks good, merge when green'); });
    const res = await send(rex, { type: 'task.accept', taskId: t.id });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
  });

  it('an AGENT\'s message is not the human\'s word', async () => {
    const t = await throughReview('agent chatter');
    await say(patch, t.id, 'merge it');
    const res = await send(rex, { type: 'task.accept', taskId: t.id });
    expect(res.status).toBe(403);
  });

  it('the human\'s own accept needs no word at all', async () => {
    const t = await throughReview('direct');
    const res = await send(george, { type: 'task.accept', taskId: t.id });
    expect(res.status).toBe(200);
    expect((await j(res)).onWord).toBeUndefined();
  });
});
