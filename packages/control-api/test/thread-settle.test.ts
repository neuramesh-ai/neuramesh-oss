// Settling a thread (0137). Three rules carry it, enforced here:
//   1. HUMAN_ONLY — an agent that could settle could take a thread out of Needs you while the human
//      still owes it a word.
//   2. ANY thread — unlike archive, a TASK thread settles: it moves the thread's status, never the board.
//   3. It is not an accept: the task's state is untouched by a settle.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const WS = 'ws_acme';

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
async function chatThread(id: string) {
  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
    body: JSON.stringify({ workspace: WS, channel: 'dev', threadId: id, body: 'a question' }),
  });
  expect(res.status).toBeLessThan(300);
  return id;
}

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

describe('thread.settle (0137)', () => {
  it('a human settles and unsettles a chat thread', async () => {
    await chatThread(T1);
    const on = await send(george, { type: 'thread.settle', workspace: WS, threadId: T1 });
    expect(on.status).toBe(200);
    expect(await j(on)).toMatchObject({ ok: true, settled: true });
    expect(store.threads.find((t) => t.id === T1)?.settledAt).toBeTruthy();

    const off = await send(george, { type: 'thread.unsettle', workspace: WS, threadId: T1 });
    expect(off.status).toBe(200);
    expect(await j(off)).toMatchObject({ ok: true, settled: false });
    expect(store.threads.find((t) => t.id === T1)?.settledAt).toBeNull();
  });

  it('an AGENT cannot settle — it could take a thread out of Needs you while you still owe it a word', async () => {
    await chatThread(T1);
    const res = await send(rex, { type: 'thread.settle', workspace: WS, threadId: T1 });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
  });

  it('a TASK thread settles too, and the task does not move — settle is not an accept', async () => {
    await chatThread(T2);
    const task = (await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'work', kind: 'feature', thread: T2 }))).task;
    expect(task).toBeTruthy();
    const res = await send(george, { type: 'thread.settle', workspace: WS, threadId: T2 });
    expect(res.status).toBe(200);
    expect((await store.getTask(task.id))?.state).toBe(task.state);
  });

  it('an unknown thread is NOT_FOUND rather than a silent success', async () => {
    const res = await send(george, { type: 'thread.settle', workspace: WS, threadId: '33333333-3333-4333-8333-333333333333' });
    expect(res.status).toBe(404);
    expect((await j(res)).code).toBe('NOT_FOUND');
  });
});
