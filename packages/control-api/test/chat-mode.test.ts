// Chat mode (docs/34): the composer's Tasks toggle, and the SERVER FLOOR under it.
//
// The daemon's chat turn is already built from a tool registry with no create_task in it. This
// file tests the second, independent stop — the one that does not depend on which code path is
// calling, so a stale client or a future caller cannot route a conversation onto the board.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// plan-first (docs/41): agent creates carry a plan; these tests are about the thread floor
const STUB_PLAN = { legs: ['build'], subtasks: [], approach: 'stub approach for the chat-mode fixtures' };

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = { workspace: 'ws_acme', channel: 'dev' };

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

const born = async (opts: { threadMode?: 'tasks' | 'chat' } = {}) => {
  const threadId = crypto.randomUUID();
  await send(george, { ...base, body: 'who else is building this?', threadId, ...opts });
  return threadId;
};

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('the mode is frozen at the thread’s birth', () => {
  it('a send with the toggle OFF births a chat thread', async () => {
    const threadId = await born({ threadMode: 'chat' });
    expect(store.threads.find((t) => t.id === threadId)?.mode).toBe('chat');
  });

  it('a send that names no mode is a TASKS thread — today’s behaviour, byte for byte', async () => {
    const threadId = await born();
    expect(store.threads.find((t) => t.id === threadId)?.mode).toBe('tasks');
  });

  it('a LATER message cannot re-mode the conversation', async () => {
    const threadId = await born({ threadMode: 'chat' });
    // an older client, a replaying daemon, or a bug: whatever the reason, the mode is the
    // thread's, and typing into it is not how it moves
    await send(george, { ...base, body: 'and their pricing?', threadId, threadMode: 'tasks' });
    expect(store.threads.find((t) => t.id === threadId)?.mode).toBe('chat');
  });

  it('an unknown mode is rejected at the schema, not coerced', async () => {
    const res = await send(george, { ...base, body: 'hi', threadId: crypto.randomUUID(), threadMode: 'whatever' });
    expect(res.status).toBe(400);
  });
});

describe('the server floor: task.create cannot name a chat thread', () => {
  it('rejects with CHAT_THREAD', async () => {
    const threadId = await born({ threadMode: 'chat' });
    const res = await cmd(rex, { type: 'task.create', ...base, title: 'Build the diff viewer', thread: threadId });
    expect(res.status).toBe(409);
    expect((await j(res)).code).toBe('CHAT_THREAD');
    // …and the message names the way out, so the human is never stuck
    expect((await j(await cmd(rex, { type: 'task.create', ...base, title: 'x', thread: threadId }))).error).toMatch(/Tasks turned off/i);
  });

  it('the floor holds for a HUMAN caller too — it is about the thread, not the actor', async () => {
    const threadId = await born({ threadMode: 'chat' });
    const res = await cmd(george, { type: 'task.create', ...base, title: 'Build it', thread: threadId, plan: STUB_PLAN });
    expect(res.status).toBe(409);
  });

  it('a TASKS thread still fans out exactly as before', async () => {
    const threadId = await born();
    const res = await cmd(rex, { type: 'task.create', ...base, title: 'Build the diff viewer', thread: threadId, plan: STUB_PLAN });
    expect(res.status).toBe(200);
    // the conversation upgrades in place — the thread links the task it became
    expect(store.threads.find((t) => t.id === threadId)?.taskId).toBe((await j(res)).task.id);
  });

  it('a task with NO thread is untouched by any of this', async () => {
    expect((await cmd(rex, { type: 'task.create', ...base, title: 'Plain task', plan: STUB_PLAN })).status).toBe(200);
  });

  it('a stale thread id fails the way it always did — absent is not a chat', async () => {
    // getThreadMode returns null for a thread that does not exist; if that were read as 'chat',
    // every stale id would start reporting a brand-new error class
    const res = await cmd(rex, { type: 'task.create', ...base, title: 'Plain task', thread: crypto.randomUUID(), plan: STUB_PLAN });
    expect(res.status).toBe(200);
  });
});

describe('thread.set_mode — the escalation valve', () => {
  it('a human flips a chat onto the board, in place', async () => {
    const threadId = await born({ threadMode: 'chat' });
    expect((await cmd(george, { type: 'thread.set_mode', workspace: base.workspace, threadId, mode: 'tasks' })).status).toBe(200);
    expect(store.threads.find((t) => t.id === threadId)?.mode).toBe('tasks');
    // and the floor lifts with it — the next message can now become work
    expect((await cmd(rex, { type: 'task.create', ...base, title: 'Build it', thread: threadId, plan: STUB_PLAN })).status).toBe(200);
  });

  it('…and back again, without touching whatever the thread already carries', async () => {
    const threadId = await born();
    await cmd(rex, { type: 'task.create', ...base, title: 'Build it', thread: threadId, plan: STUB_PLAN });
    const taskId = store.threads.find((t) => t.id === threadId)?.taskId;
    await cmd(george, { type: 'thread.set_mode', workspace: base.workspace, threadId, mode: 'chat' });
    expect(store.threads.find((t) => t.id === threadId)?.taskId).toBe(taskId);
  });

  it('an AGENT cannot move its own conversation onto the board', async () => {
    const threadId = await born({ threadMode: 'chat' });
    const res = await cmd(rex, { type: 'thread.set_mode', workspace: base.workspace, threadId, mode: 'tasks' });
    expect(res.status).toBe(403);
    expect((await j(res)).code).toBe('NOT_PERMITTED');
    expect(store.threads.find((t) => t.id === threadId)?.mode).toBe('chat');
  });

  it('a thread that does not exist is NOT_FOUND', async () => {
    expect((await cmd(george, { type: 'thread.set_mode', workspace: base.workspace, threadId: crypto.randomUUID(), mode: 'chat' })).status).toBe(404);
  });
});
