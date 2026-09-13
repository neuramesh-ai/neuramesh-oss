// Archiving a conversation (0108). Two rules carry the whole feature, and both are enforced here
// rather than asked for in a prompt or hidden in a renderer:
//   1. HUMAN_ONLY — an agent that could archive could hide a conversation you are waiting on.
//   2. CHAT ONLY  — a task thread is the board's record of a work attempt; hiding it would leave a
//      task that still counts as open with nowhere to read it.
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

// a conversation is born by a message naming a thread that does not exist yet
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

describe('thread.archive (0108)', () => {
  it('a human archives and unarchives a chat thread', async () => {
    await chatThread(T1);
    const on = await send(george, { type: 'thread.archive', workspace: WS, threadId: T1 });
    expect(on.status).toBe(200);
    expect(await j(on)).toMatchObject({ ok: true, archived: true });
    expect(await store.threadTaskId(WS, T1)).toBe(null);   // still a chat thread; nothing destroyed

    const off = await send(george, { type: 'thread.unarchive', workspace: WS, threadId: T1 });
    expect(off.status).toBe(200);
    expect(await j(off)).toMatchObject({ ok: true, archived: false });
  });

  it('an AGENT cannot archive — it could otherwise hide a conversation you are waiting on', async () => {
    await chatThread(T1);
    const res = await send(rex, { type: 'thread.archive', workspace: WS, threadId: T1 });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('HUMAN_ONLY');
  });

  it('a TASK thread refuses — its life belongs to the board', async () => {
    await chatThread(T2);
    const task = (await j(await send(george, { type: 'task.create', workspace: WS, channel: 'dev', title: 'work', kind: 'feature', thread: T2 }))).task;
    expect(task).toBeTruthy();
    const res = await send(george, { type: 'thread.archive', workspace: WS, threadId: T2 });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('TASK_THREAD');
  });

  it('an unknown thread is NOT_FOUND rather than a silent success', async () => {
    const res = await send(george, { type: 'thread.archive', workspace: WS, threadId: '33333333-3333-4333-8333-333333333333' });
    expect(res.status).toBe(404);
    expect((await j(res)).code).toBe('NOT_FOUND');
  });
});
