// One wake-reply per (agent, trigger message) — the server-side dedupe that makes the
// #1010 double-reply class impossible (two live daemons racing the same human message).
// Memory-store leg; the pg leg (reply-dedupe.pg.test.ts) proves 0060's partial unique index.
import { describe, expect, it } from 'vitest';
import { MemoryStore, type NMMessage } from '../src/store';
import { DomainError } from '../src/errors';

const msg = (over: Partial<NMMessage>): NMMessage => ({
  id: crypto.randomUUID(),
  workspace: 'ws1',
  channel: 'dev',
  taskId: 'task-1',
  author: { kind: 'agent', id: 'aaaa0000-0000-0000-0000-000000000004' },
  body: "I'm the assigned worker — picking it up.",
  createdAt: new Date().toISOString(),
  ...over,
});

const evt = () => ({
  id: crypto.randomUUID(),
  type: 'message.posted',
  source: 'agent:x',
  target: 'task:1',
  workspace: 'ws1',
  payload: {},
  in_reply_to: null,
  ts: new Date().toISOString(),
}) as never;

describe('reply dedupe — one reply per (agent, trigger)', () => {
  it('a second reply by the SAME agent to the SAME trigger is CONFLICT', async () => {
    const store = new MemoryStore();
    const trigger = crypto.randomUUID();
    await store.postMessage(msg({ replyTo: trigger }), evt());
    await expect(store.postMessage(msg({ replyTo: trigger }), evt())).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('different agents may each reply to the same trigger', async () => {
    const store = new MemoryStore();
    const trigger = crypto.randomUUID();
    await store.postMessage(msg({ replyTo: trigger }), evt());
    await expect(
      store.postMessage(msg({ replyTo: trigger, author: { kind: 'agent', id: 'aaaa0000-0000-0000-0000-000000000001' } }), evt()),
    ).resolves.toBeTruthy();
  });

  it('the same agent may reply to different triggers', async () => {
    const store = new MemoryStore();
    await store.postMessage(msg({ replyTo: crypto.randomUUID() }), evt());
    await expect(store.postMessage(msg({ replyTo: crypto.randomUUID() }), evt())).resolves.toBeTruthy();
  });

  it('messages without replyTo are never deduped (normal chat is unlimited)', async () => {
    const store = new MemoryStore();
    await store.postMessage(msg({}), evt());
    await expect(store.postMessage(msg({}), evt())).resolves.toBeTruthy();
    expect(DomainError).toBeDefined(); // import used for the CONFLICT match above
  });
});
