// The card push names the ROOM. The daemon posts by channel id, so the title used to carry a
// UUID fragment ("A question for you · #b66…" on George's lock screen, 2026-09-08): the one
// word in the push that said where to look was unreadable. Route-level, with the real
// PushService over the memory store, because the `where` is composed in the route.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PushService, type ExpoPushMessage, type ExpoTicket, type PushSender } from '../src/push';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const nmq = 'Which deploy target?\n\n```nmq\n{}\n```';

let store: MemoryStore;
let app: ReturnType<typeof createApp>;
let ws: string;
let channelId: string;
const sent: ExpoPushMessage[] = [];

beforeEach(async () => {
  store = new MemoryStore();
  sent.length = 0;
  const sender: PushSender = {
    async send(messages) {
      sent.push(...messages);
      return messages.map((): ExpoTicket => ({ status: 'ok' }));
    },
  };
  app = createApp(store, { push: new PushService(store, sender) });
  ({ workspaceId: ws } = await store.createWorkspace(
    { name: 'Acme', slug: 'acme', createdBy: 'george' },
    createEvent({ type: 'workspace.created', source: formatAddress(george), target: 'resource/workspace/acme', workspace: 'acme', payload: {} }),
  ));
  ({ id: channelId } = await store.createChannel(
    { workspace: ws, projectId: 'p-acme', slug: 'growth', topic: 'growth work' },
    createEvent({ type: 'channel.created', source: formatAddress(george), target: 'resource/channel/growth', workspace: ws, payload: {} }),
  ));
  await store.registerDevice({ userId: 'george', platform: 'ios', token: 'tok-george' });
});

const post = (actor: Actor, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

// the push is fire-and-forget behind the response, so give the chain its ticks
const settled = async () => {
  for (let i = 0; i < 20 && !sent.length; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('the card push names the room', () => {
  it('a card posted by channel ID pushes with the room slug, never the id', async () => {
    const room = await store.channelProject(ws, channelId);
    expect(room?.slug).toBeTruthy();
    const res = await post(rex, { workspace: ws, channel: channelId, body: nmq });
    expect(res.status).toBe(200);
    await settled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe(`A question for you · #${room!.slug}`);
    expect(sent[0]!.title).not.toContain(channelId);
  });

  it('a card posted by slug keeps that slug', async () => {
    const room = await store.channelProject(ws, channelId);
    await post(rex, { workspace: ws, channel: room!.slug, body: nmq });
    await settled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe(`A question for you · #${room!.slug}`);
  });

  it('a plain agent message pushes nothing', async () => {
    await post(rex, { workspace: ws, channel: channelId, body: 'on it, back in ten' });
    await settled();
    expect(sent).toHaveLength(0);
  });
});
