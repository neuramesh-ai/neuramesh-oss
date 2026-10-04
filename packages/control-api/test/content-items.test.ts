// content items (marketing-channel plan §4.7): agents DRAFT, humans PUBLISH — approve is
// HUMAN_ONLY (the approve_design guard, structural); unschedule bounces to draft.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };

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

async function makeRoom(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
  return chan.channelId as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('content items — agents draft, humans publish', () => {
  it('an agent drafts a content item (born draft, no clock)', async () => {
    const channel = await makeRoom();
    const r = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'Subagents forget everything. Your team shouldn’t.' }));
    expect(r.itemId).toBeTruthy();
  });

  it('approve is HUMAN_ONLY and puts the item on the clock; agents are refused', async () => {
    const channel = await makeRoom();
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, body: 'draft one' }));
    expect((await send(plume, { type: 'content.approve', item: itemId })).status).toBe(403);
    const ok = await send(george, { type: 'content.approve', item: itemId, scheduledAt: new Date(Date.now() + 7200e3).toISOString() });
    expect(ok.status).toBe(200);
  });

  it('a past scheduledAt is refused; a bare approve defaults one hour out', async () => {
    const channel = await makeRoom();
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, body: 'draft two' }));
    expect((await send(george, { type: 'content.approve', item: itemId, scheduledAt: '2020-01-01T00:00:00Z' })).status).toBe(422);
    expect((await send(george, { type: 'content.approve', item: itemId })).status).toBe(200);
  });

  it('unschedule bounces a scheduled item back to draft (human-only)', async () => {
    const channel = await makeRoom();
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, body: 'draft three' }));
    await send(george, { type: 'content.approve', item: itemId });
    expect((await send(plume, { type: 'content.unschedule', item: itemId })).status).toBe(403);
    expect((await send(george, { type: 'content.unschedule', item: itemId })).status).toBe(200);
  });

  it('an unknown item is NOT_FOUND; a bogus platform is schema-rejected (tiktok is real now)', async () => {
    const channel = await makeRoom();
    expect((await send(george, { type: 'content.approve', item: 'ffffffff-0000-0000-0000-000000000000' })).status).toBe(404);
    expect((await send(plume, { type: 'content.create', channel, platform: 'carrier-pigeon', body: 'nope' })).status).toBe(400);
    expect((await send(plume, { type: 'content.create', channel, platform: 'tiktok', body: 'a tiktok draft' })).status).toBe(200);
  });

  it('the human edits and deletes drafts from the calendar; agents cannot; published stays', async () => {
    const channel = await makeRoom();
    const c = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'first cut' }));
    expect((await send(plume, { type: 'content.update', item: c.itemId, body: 'agent rewrite' })).status).toBe(403);
    expect((await send(george, { type: 'content.update', item: c.itemId, body: 'human polish' })).status).toBe(200);
    expect((await send(plume, { type: 'content.delete', item: c.itemId })).status).toBe(403);
    expect((await send(george, { type: 'content.delete', item: c.itemId })).status).toBe(200);
    expect((await send(george, { type: 'content.delete', item: c.itemId })).status).toBe(404);
  });

  it('the marketer revises drafts from a free-form ask; revising a SCHEDULED post unschedules it for re-approval', async () => {
    const channel = await makeRoom();
    const items = () => (store as unknown as { contentItems: Array<{ id: string; status: string; body: string; scheduledAt: string | null; approvedBy: string | null }> }).contentItems;

    // a plain draft: the marketer rewrites the copy in place, it stays a draft (this is the path a
    // free-form "remove the em dashes" reply drives — previously blocked once a post was scheduled)
    const a = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'first cut — with an em dash' }));
    expect((await send(plume, { type: 'content.revise', item: a.itemId, body: 'first cut, cleaned up' })).status).toBe(200);
    const ra = items().find((x) => x.id === a.itemId);
    expect(ra?.status).toBe('draft');
    expect(ra?.body).toBe('first cut, cleaned up');

    // a scheduled post: revising the copy pulls it OFF the publish queue, back to draft, cleared of
    // approval — so the changed text can never auto-publish on the old slot without a fresh approve
    const b = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'scheduled copy' }));
    await send(george, { type: 'content.approve', item: b.itemId, scheduledAt: new Date(Date.now() + 7200e3).toISOString() });
    expect(items().find((x) => x.id === b.itemId)?.status).toBe('scheduled');
    expect((await send(plume, { type: 'content.revise', item: b.itemId, body: 'scheduled copy, tightened' })).status).toBe(200);
    const rb = items().find((x) => x.id === b.itemId);
    expect(rb?.status).toBe('draft');
    expect(rb?.scheduledAt).toBeNull();
    expect(rb?.approvedBy).toBeNull();
    expect(rb?.body).toBe('scheduled copy, tightened');
  });

  // a draft with no conversation gets one (George, 2026-09-27): a tab or the phone opens a session
  // with its picture ask, then moves the draft into it, so the next ask lands in the same place
  it('content.anchor moves a draft with no home into a session in its own room, once, on a human word', async () => {
    const channel = await makeRoom();
    const items = () => (store as unknown as { contentItems: Array<{ id: string; threadId: string | null }> }).contentItems;
    const born = async (room: string) => {
      const threadId = crypto.randomUUID();
      const r = await app.request('/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
        body: JSON.stringify({ workspace: 'ws_acme', channel: room, threadId, body: 'Generate the image for “no home yet”\n\n‹gen-image:00000000›' }),
      });
      expect(r.status).toBe(200);
      return threadId;
    };
    const c = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'no home yet' }));
    const t1 = await born(channel);
    expect((await send(plume, { type: 'content.anchor', item: c.itemId, thread: t1 })).status).toBe(403);
    expect((await send(george, { type: 'content.anchor', item: c.itemId, thread: t1 })).status).toBe(200);
    expect(items().find((x) => x.id === c.itemId)?.threadId).toBe(t1);
    // an anchored draft never moves again
    expect((await send(george, { type: 'content.anchor', item: c.itemId, thread: await born(channel) })).status).toBe(404);
  });

  it('content.anchor refuses a conversation in another room, and a draft that already rides a task', async () => {
    const channel = await makeRoom();
    const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Other' }));
    const elsewhere = (await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'elsewhere' }))).channelId as string;
    const threadId = crypto.randomUUID();
    await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
      body: JSON.stringify({ workspace: 'ws_acme', channel: elsewhere, threadId, body: 'a session in another room' }),
    });
    const orphan = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'no home yet' }));
    expect((await send(george, { type: 'content.anchor', item: orphan.itemId, thread: threadId })).status).toBe(404);
    const onTask = await j(await send(plume, { type: 'content.create', channel, task: crypto.randomUUID(), platform: 'x', body: 'rides a task' }));
    expect((await send(george, { type: 'content.anchor', item: onTask.itemId, thread: threadId })).status).toBe(404);
    // the schema holds both ids to uuids, so a slug never reaches the store's cast
    expect((await send(george, { type: 'content.anchor', item: 'not-a-uuid', thread: threadId })).status).toBe(400);
  });

  it('approve keeps a future draft-ahead slot; explicit time overrides', async () => {
    const channel = await makeRoom();
    const slot = new Date(Date.now() + 20 * 60_000).toISOString();
    const c = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'slotted', slotAt: slot }));
    expect((await send(george, { type: 'content.approve', item: c.itemId })).status).toBe(200);
    const kept = (store as unknown as { contentItems: Array<{ id: string; scheduledAt: string | null }> }).contentItems.find((x) => x.id === c.itemId);
    expect(kept?.scheduledAt).toBe(slot);
  });
});
