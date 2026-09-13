// Replies (docs/31): replying to a room message births a thread that REFERENCES it. The root
// keeps its place in the feed — it is never moved into the thread.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function post(actor: Actor, body: unknown) {
  return app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const base = { workspace: 'ws_acme', channel: 'dev' };

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('reply → thread (docs/31)', () => {
  it('a reply births a thread that points back at the root message', async () => {
    const { message: root } = await j(await post(george, { ...base, body: 'the drawer still traps focus on iPad' }));
    const threadId = crypto.randomUUID();
    expect((await post(george, { ...base, body: 'only on iPad?', threadId, rootMessageId: root.id })).status).toBe(200);

    expect(store.threads.find((x) => x.id === threadId)?.rootMessageId).toBe(root.id);
  });

  it('the ROOT keeps its place in the feed — it is referenced, not moved', async () => {
    const { message: root } = await j(await post(george, { ...base, body: 'the drawer still traps focus' }));
    const threadId = crypto.randomUUID();
    const { message: reply } = await j(await post(george, { ...base, body: 'reproducing now', threadId, rootMessageId: root.id }));

    // the root stays a channel-root message — no thread_id, so the feed keeps showing it
    expect(root.threadId ?? null).toBeNull();
    // the reply, by contrast, belongs to the thread
    expect(reply.threadId).toBe(threadId);
  });

  // The Home composer names no root — its message IS the opener. The server roots the thread at
  // it, because the feed shows a thread's root and hides its replies: a rootless thread swallows
  // its own opening message, so the room you just posted into shows no trace of it.
  it('a thread born from a message with no named root is rooted at that message', async () => {
    const threadId = crypto.randomUUID();
    const { message: opener } = await j(await post(george, { ...base, body: 'lets plan the launch', threadId }));

    expect(store.threads.find((x) => x.id === threadId)?.rootMessageId).toBe(opener.id);
  });

  it('a later message in a Home-born thread does not steal the root', async () => {
    const threadId = crypto.randomUUID();
    const { message: opener } = await j(await post(george, { ...base, body: 'lets plan the launch', threadId }));
    await post(george, { ...base, body: 'agreed, starting friday', threadId });

    expect(store.threads.find((x) => x.id === threadId)?.rootMessageId).toBe(opener.id);
  });

  it('later replies do not re-root the thread', async () => {
    const { message: root } = await j(await post(george, { ...base, body: 'first' }));
    const { message: other } = await j(await post(george, { ...base, body: 'unrelated' }));
    const threadId = crypto.randomUUID();
    await post(george, { ...base, body: 'a', threadId, rootMessageId: root.id });
    await post(george, { ...base, body: 'b', threadId, rootMessageId: other.id });
    expect(store.threads.find((x) => x.id === threadId)?.rootMessageId).toBe(root.id);
  });
});
