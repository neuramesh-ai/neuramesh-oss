// The reply queue (docs/design/models-and-replies-2026-10/plan.md §2). What must hold: a person queues
// the rows of a reply card and the SERVER reads the drafts and links off the card (X's reply box with the
// text in it); an agent can never queue; a row is its member's alone; Clear keeps the done rows; the minute
// cron reminds once and marks the row due; a routine whose Replies part names a gap gets its run's card
// queued for its owner; and the routine's gap rides schedule.create and schedule.update.
import { repliesBlock, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PushService, type ExpoPushMessage } from '../src/push';
import { queueRoutineReplies, remindDueReplies } from '../src/reply-cron';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const ana: Actor = { kind: 'human', id: 'ana' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });

const CARD = repliesBlock({
  channel: 'marketing',
  items: [
    { letter: 'A', target: { handle: 'eng_khairallah1', url: 'https://x.com/eng_khairallah1/status/2105769157317013669', platform: 'x', source: 'connector', text: 'build your first AI agent team' }, draft: 'Specialized roles make a huge difference.' },
    { letter: 'B', target: { handle: 'loopwright', url: 'https://x.com/loopwright/status/1234567', platform: 'x', source: 'connector', text: 'agent teams fail at the hand-off' }, draft: 'Agreed. A short written plan fixes most of it.' },
    { letter: 'C', target: { handle: 'pm_kyle', url: 'https://www.linkedin.com/feed/update/77', platform: 'linkedin', source: 'web', text: 'a human gate before ship' }, draft: 'Same here.' },
  ],
});

async function room(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
  return chan.channelId as string;
}
async function cardMessage(channel: string): Promise<string> {
  const r = await j(await app.request('/v1/messages', { method: 'POST', headers: hdr(rex), body: JSON.stringify({ workspace: 'ws_acme', channel, body: `Three posts passed the bar.\n\n${CARD}` }) }));
  return r.message.id as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
  // membership is what actorInWorkspace reads (humanMemberIds); the memory store keeps it here
  const members = store as unknown as { addMember(workspace: string, userId: string): void };
  members.addMember('ws_acme', 'george');
  members.addMember('ws_acme', 'ana');
});

describe('reply.queue', () => {
  it('queues the card rows a gap apart, with the links the server reads off the card', async () => {
    const message = await cardMessage(await room());
    const start = new Date(Date.now() + 60_000).toISOString();
    const r = await send(george, { type: 'reply.queue', message, letters: ['A', 'B', 'C'], gapMin: 8, startAt: start });
    expect(r.status).toBe(200);
    expect((await j(r)).queued).toBe(3);
    const rows = store.replies.rows.sort((a, b) => a.letter.localeCompare(b.letter));
    expect(rows.map((x) => x.memberId)).toEqual(['george', 'george', 'george']);
    expect(rows[0]!.openUrl).toBe(`https://x.com/intent/tweet?in_reply_to=2105769157317013669&text=${encodeURIComponent('Specialized roles make a huge difference.')}`);
    // a row X cannot open a reply box for opens the post itself
    expect(rows[2]!.openUrl).toBe('https://www.linkedin.com/feed/update/77');
    expect(Date.parse(rows[1]!.dueAt) - Date.parse(rows[0]!.dueAt)).toBe(8 * 60_000);
    expect(rows.every((x) => x.state === 'queued')).toBe(true);
  });

  it('never lets an agent queue, and refuses letters the card does not have', async () => {
    const message = await cardMessage(await room());
    const at = new Date().toISOString();
    expect((await send(rex, { type: 'reply.queue', message, letters: ['A'], gapMin: 5, startAt: at })).status).toBe(403);
    expect((await send(george, { type: 'reply.queue', message, letters: ['Z'], gapMin: 5, startAt: at })).status).toBe(422);
    expect((await send(george, { type: 'reply.queue', message, letters: ['A'], gapMin: 7, startAt: at })).status).toBe(400);
  });

  it('queues a row again at its new time, owed again', async () => {
    const message = await cardMessage(await room());
    await send(george, { type: 'reply.queue', message, letters: ['A'], gapMin: 5, startAt: new Date().toISOString() });
    const [row] = store.replies.rows;
    await send(george, { type: 'reply.mark', reminder: row!.id, state: 'skipped' });
    const later = new Date(Date.now() + 3600_000).toISOString();
    await send(george, { type: 'reply.queue', message, letters: ['A'], gapMin: 5, startAt: later });
    expect(store.replies.rows).toHaveLength(1);
    expect(store.replies.rows[0]).toMatchObject({ state: 'queued', dueAt: later });
  });
});

describe('reply.mark and reply.clear', () => {
  it('marks only the member\'s own row', async () => {
    const message = await cardMessage(await room());
    await send(george, { type: 'reply.queue', message, letters: ['A', 'B'], gapMin: 5, startAt: new Date().toISOString() });
    const [a] = store.replies.rows;
    expect((await send(ana, { type: 'reply.mark', reminder: a!.id, state: 'posted' })).status).toBe(404);
    expect((await send(george, { type: 'reply.mark', reminder: a!.id, state: 'opened' })).status).toBe(200);
    expect(store.replies.rows.find((x) => x.id === a!.id)!.state).toBe('opened');
  });

  it('clears the owed rows and keeps the done ones as the record', async () => {
    const message = await cardMessage(await room());
    await send(george, { type: 'reply.queue', message, letters: ['A', 'B', 'C'], gapMin: 5, startAt: new Date().toISOString() });
    const a = store.replies.rows.find((x) => x.letter === 'A')!;
    await send(george, { type: 'reply.mark', reminder: a.id, state: 'posted' });
    expect((await j(await send(george, { type: 'reply.clear', message }))).cleared).toBe(2);
    expect(store.replies.rows.map((x) => [x.letter, x.state])).toEqual([['A', 'posted']]);
  });
});

describe('the minute pass', () => {
  it('reminds a due row once, to its member only, with the link in the data, then marks it due', async () => {
    const message = await cardMessage(await room());
    await send(george, { type: 'reply.queue', message, letters: ['A', 'B'], gapMin: 20, startAt: new Date().toISOString() });
    await store.registerDevice({ userId: 'george', platform: 'ios', token: 'ExponentPushToken[george]' });
    const sent: ExpoPushMessage[] = [];
    const push = new PushService(store, { send: async (m) => { sent.push(...m); return m.map(() => ({ status: 'ok' as const })); } });
    const now = new Date(Date.now() + 60_000);
    expect(await remindDueReplies(store, push, now)).toBe(1);
    expect(await remindDueReplies(store, push, now)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Reply A is ready to post', body: '@eng_khairallah1 · Tap to open it in X with the text in it.' });
    expect((sent[0]!.data as { url: string }).url.startsWith('https://x.com/intent/tweet?in_reply_to=2105769157317013669')).toBe(true);
    expect(store.replies.rows.find((x) => x.letter === 'A')).toMatchObject({ state: 'due' });
    expect(store.replies.rows.find((x) => x.letter === 'B')).toMatchObject({ state: 'queued', notifiedAt: null });
  });

  it('queues a routine card for the routine\'s owner, from the time it landed', async () => {
    const message = await cardMessage(await room());
    const landed = new Date(Date.now() + 5_000).toISOString();
    store.replies.routineCards.push({ messageId: message, workspaceId: 'ws_acme', threadId: 'th_routine', body: CARD, createdAt: landed, memberId: 'george', gap: 12 });
    expect(await queueRoutineReplies(store, new Date())).toBe(3);
    expect(await queueRoutineReplies(store, new Date())).toBe(0);
    const a = store.replies.rows.find((x) => x.letter === 'A')!;
    expect(a.dueAt).toBe(landed);
    expect(Date.parse(store.replies.rows.find((x) => x.letter === 'B')!.dueAt) - Date.parse(landed)).toBe(12 * 60_000);
  });
});

describe('the routine\'s gap', () => {
  it('rides schedule.create into the payload, and schedule.update with null drops it', async () => {
    const channel = await room();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const base = { title: 'Morning X reply drafts', prompt: 'Find posts. Draft replies.', cadence: 'daily', atTime: '08:00', tz: 'UTC' };
    const { scheduleId } = await j(await send(george, { type: 'schedule.create', channel, routine: true, replyGap: 8, ...base }));
    const row = () => (store as unknown as { schedules: Array<{ id: string; payload: Record<string, unknown> }> }).schedules.find((x) => x.id === scheduleId)!;
    expect(row().payload).toMatchObject({ routine: true, replyGap: 8 });
    await send(george, { type: 'schedule.update', schedule: scheduleId, ...base, replyGap: 12 });
    expect(row().payload['replyGap']).toBe(12);
    await send(george, { type: 'schedule.update', schedule: scheduleId, ...base, replyGap: null });
    expect(row().payload['replyGap']).toBeUndefined();
    await send(george, { type: 'schedule.update', schedule: scheduleId, ...base });
    expect(row().payload['replyGap']).toBeUndefined();
  });
});
