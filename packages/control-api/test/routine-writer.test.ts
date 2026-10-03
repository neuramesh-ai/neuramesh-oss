// The routine writer (docs/design/routine-writer-2026-10): schedule.create with `thread` arms the routine rex
// wrote in a session, links that session to it and posts the divider there, in one step. A session holds one
// routine, a task's thread and a coding thread hold none, and the routine runs in its session's room. The
// memory store is the contract. routine-writer.pg.test.ts locks the same rules against the real schema.
import { ROUTINE_SCHEDULED_MARKER, routineBlock, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const req = (actor: Actor, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
let ROOM = '';
let OTHER = '';
const born = async (opts: Record<string, unknown> = {}) => {
  const threadId = crypto.randomUUID();
  await req(george, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, body: 'Make a routine: every weekday at 9, list the new issues.', threadId, ...opts });
  return threadId;
};
const routine = (thread: string, extra: Record<string, unknown> = {}) => ({
  type: 'schedule.create', channel: ROOM, title: 'New issues each morning', prompt: 'Goal: list the new issues.', cadence: 'weekdays', atTime: '09:00', tz: 'UTC', thread, ...extra,
});
const threadOf = (id: string) => store.threads.find((t) => t.id === id)!;

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  const proj = await j(await req(george, '/v1/commands', { type: 'project.create', workspace: 'ws_acme', name: 'Ops' }));
  ROOM = (await j(await req(george, '/v1/commands', { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'dev' }))).channelId as string;
  OTHER = (await j(await req(george, '/v1/commands', { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'ops' }))).channelId as string;
  await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
});

describe('schedule.create with the session rex wrote the routine in', () => {
  it('links the session, posts the divider as the person, and names the session after the routine', async () => {
    const threadId = await born();
    const res = await req(george, '/v1/commands', routine(threadId));
    expect(res.status).toBe(200);
    const { scheduleId } = await j(res);
    expect(threadOf(threadId).scheduleId).toBe(scheduleId);
    expect(threadOf(threadId).title).toBe('New issues each morning');
    const divider = store.messages.filter((m) => m.threadId === threadId).at(-1)!;
    expect(divider).toMatchObject({ body: ROUTINE_SCHEDULED_MARKER, author: { kind: 'human', id: 'george' }, channel: ROOM });
    // a session's routine is a routine, never a drafting schedule, whatever the client sent
    expect((store as unknown as { schedules: Array<{ id: string; payload: Record<string, unknown> }> }).schedules.find((s) => s.id === scheduleId)!.payload['routine']).toBe(true);
  });

  it('a session holds one routine: the second click is refused, and nothing is armed twice', async () => {
    const threadId = await born();
    expect((await req(george, '/v1/commands', routine(threadId))).status).toBe(200);
    const again = await req(george, '/v1/commands', routine(threadId));
    expect(again.status).toBe(409);
    expect((await j(again)).code).toBe('THREAD_HAS_ROUTINE');
    expect((store as unknown as { schedules: unknown[] }).schedules).toHaveLength(1);
    expect(store.messages.filter((m) => m.body === ROUTINE_SCHEDULED_MARKER)).toHaveLength(1);
  });

  it("a task's thread and a coding thread hold no routine", async () => {
    const task = await born();
    threadOf(task).taskId = 'task-1';
    expect((await j(await req(george, '/v1/commands', routine(task)))).code).toBe('TASK_THREAD');
    const coding = await born({ threadKind: 'coding' });
    expect((await j(await req(george, '/v1/commands', routine(coding)))).code).toBe('CODING_THREAD');
  });

  it("the routine runs in its session's room, and the session must exist", async () => {
    const threadId = await born();
    expect((await req(george, '/v1/commands', routine(threadId, { channel: OTHER }))).status).toBe(422);
    expect((await req(george, '/v1/commands', routine(crypto.randomUUID()))).status).toBe(404);
  });

  it('agents still only propose, and a free workspace still meets the plan gate', async () => {
    const threadId = await born();
    expect((await req(rex, '/v1/commands', routine(threadId))).status).toBe(403);
    await store.setWorkspacePlan('ws_acme', { plan: 'free' });
    expect((await req(george, '/v1/commands', routine(threadId))).status).toBe(402);
    expect(threadOf(threadId).scheduleId ?? null).toBeNull();
  });

  it('without a session, schedule.create is unchanged', async () => {
    const res = await req(george, '/v1/commands', { ...routine(''), thread: undefined });
    expect(res.status).toBe(200);
    expect(store.messages.some((m) => m.body === ROUTINE_SCHEDULED_MARKER)).toBe(false);
  });

  it('a draft card waits on its person: it mints a decision, Schedule it before the link and Update after it', async () => {
    const threadId = await born();
    const draft = { title: 'New issues each morning', cadence: 'weekdays', atTime: '09:00', goal: 'g', eachRun: 'e', rules: 'r', output: 'o', ifNone: 'n' } as const;
    const post = () => req(rex, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: routineBlock({ kind: 'draft', draft }), routineCard: true });
    expect((await post()).status).toBe(200);
    expect((await store.listDecisions('ws_acme')).filter((d) => d.status === 'open').map((d) => d.question)).toContain('Schedule the routine “New issues each morning”?');
    expect((await req(george, '/v1/commands', routine(threadId))).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect((await store.listDecisions('ws_acme')).map((d) => d.question)).toContain('Update the routine “New issues each morning”?');
  });

  it('a card an agent wrote into its reply is dropped: only the routine tools post one', async () => {
    // the third live run copied v1's block from its transcript and wrote v2 by hand, past every check
    const threadId = await born();
    const draft = { title: 'Written by hand', cadence: 'weekdays', atTime: '09:00', goal: 'g', eachRun: 'e', rules: 'r', output: 'o', ifNone: 'n' } as const;
    const block = routineBlock({ kind: 'draft', draft });
    expect((await req(rex, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: `${block}\n\nI updated it. Click approve.` })).status).toBe(200);
    const kept = store.messages.filter((m) => m.threadId === threadId && m.author.kind === 'agent');
    expect(kept.map((m) => m.body)).toEqual(['I updated it. Click approve.']);
    expect((await store.listDecisions('ws_acme')).map((d) => d.question)).not.toContain('Schedule the routine “Written by hand”?');
    // a reply that was only the card has nothing left to post
    const only = await req(rex, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: block });
    expect(only.status).toBe(422);
    // a person's words are never cut
    expect((await req(george, '/v1/messages', { workspace: 'ws_acme', channel: ROOM, threadId, body: block })).status).toBe(200);
    expect(store.messages.some((m) => m.threadId === threadId && m.author.kind === 'human' && m.body === block)).toBe(true);
  });
});
