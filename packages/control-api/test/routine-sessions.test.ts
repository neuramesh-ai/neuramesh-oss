// Routine sessions (docs/design/routine-sessions-2026-09/plan.md): one session holds every run of its
// schedule. A run opens with the message the launcher posts, and that message keeps its schedule (0145),
// so a client splits the session into runs with no text marker. Run now makes the schedule due at once.
// The session wears the routine's title (PR 2): the rail shows one row per routine, under its own name.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const call = (path: string, actor: Actor, body: unknown) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
  body: JSON.stringify(body),
});
const send = (actor: Actor, body: unknown) => call('/v1/commands', actor, body);

type SchedRow = { id: string; status: string; nextRunAt: string | null };
const schedRow = (id: string): SchedRow => (store as unknown as { schedules: SchedRow[] }).schedules.find((x) => x.id === id)!;
const stored = (id: string) => store.messages.find((m) => m.id === id)!;

async function armRoutine(): Promise<{ channel: string; schedule: string }> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'dev' }));
  await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
  const s = await j(await send(george, { type: 'schedule.create', channel: chan.channelId, title: 'Morning dependency audit', prompt: 'Check our top 20 dependencies.', cadence: 'daily', atTime: '09:00', tz: 'UTC', routine: true }));
  return { channel: chan.channelId as string, schedule: s.scheduleId as string };
}

async function post(actor: Actor, body: Record<string, unknown>): Promise<string> {
  const r = await call('/v1/messages', actor, { workspace: 'ws_acme', ...body });
  expect(r.status).toBe(200);
  return (await j(r)).message.id as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('a run opens with a message that keeps its schedule (0145)', () => {
  it('the opener keeps the schedule, and a reply in the same session does not', async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    const opener = await post(george, { channel, threadId, scheduleId: schedule, body: 'Morning dependency audit\n\nCheck our top 20 dependencies.' });
    const reply = await post(rex, { channel, threadId, body: 'No new CVEs today.' });
    expect(stored(opener).scheduleId).toBe(schedule);
    expect(stored(reply).scheduleId ?? null).toBeNull();
  });

  it('a later run posted into the same session opens a second run', async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Morning dependency audit\n\nday one' });
    const second = await post(george, { channel, threadId, scheduleId: schedule, body: 'Morning dependency audit\n\nday two' });
    expect(stored(second).scheduleId).toBe(schedule);
    expect(store.messages.filter((m) => m.threadId === threadId && m.scheduleId === schedule)).toHaveLength(2);
  });

  it('a schedule id this workspace does not own is dropped, and the post still lands', async () => {
    const { channel } = await armRoutine();
    const id = await post(george, { channel, threadId: crypto.randomUUID(), scheduleId: crypto.randomUUID(), body: 'Routine · stray' });
    expect(stored(id).scheduleId ?? null).toBeNull();
  });
});

describe('schedule.run_now', () => {
  it('a person makes the schedule due at once', async () => {
    const { schedule } = await armRoutine();
    expect(new Date(schedRow(schedule).nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    const r = await send(george, { type: 'schedule.run_now', schedule });
    expect(r.status).toBe(200);
    expect(new Date(schedRow(schedule).nextRunAt!).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('an agent is refused: a person runs a routine now', async () => {
    const { schedule } = await armRoutine();
    const r = await send(rex, { type: 'schedule.run_now', schedule });
    expect(r.status).toBe(403);
    expect((await j(r)).code).toBe('HUMAN_ONLY');
  });

  it('a paused routine is refused with the way out, and an unknown one is not found', async () => {
    const { schedule } = await armRoutine();
    await send(george, { type: 'schedule.set_status', schedule, status: 'paused' });
    const paused = await send(george, { type: 'schedule.run_now', schedule });
    expect(paused.status).toBe(422);
    expect((await j(paused)).error).toMatch(/Resume it, then run it/);
    expect((await send(george, { type: 'schedule.run_now', schedule: crypto.randomUUID() })).status).toBe(404);
  });
});

describe("a routine's session wears the routine's title (PR 2)", () => {
  const titleOf = (id: string): string => (store as unknown as { threads: Array<{ id: string; title: string }> }).threads.find((t) => t.id === id)!.title;
  const rename = (schedule: string, title: string) => send(george, { type: 'schedule.update', schedule, title, prompt: 'Check our top 20 dependencies.', cadence: 'daily', atTime: '09:00', tz: 'UTC' });

  it('the first run names the session after the routine, not after the opener', async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Morning dependency audit\n\nCheck our top 20 dependencies.' });
    expect(titleOf(threadId)).toBe('Morning dependency audit');
  });

  it("a later run gives the session the routine's new title, and a reply keeps it", async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Morning dependency audit\n\nday one' });
    await post(rex, { channel, threadId, body: 'No new CVEs today.' });
    expect(titleOf(threadId)).toBe('Morning dependency audit');
    expect((await rename(schedule, 'Evening dependency audit')).status).toBe(200);
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Evening dependency audit\n\nday two' });
    expect(titleOf(threadId)).toBe('Evening dependency audit');
  });

  it("a person's rename of the session stays through later runs", async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Morning dependency audit\n\nday one' });
    expect((await send(george, { type: 'thread.update', workspace: 'ws_acme', threadId, title: 'Deps check' })).status).toBe(200);
    await rename(schedule, 'Evening dependency audit');
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Evening dependency audit\n\nday two' });
    expect(titleOf(threadId)).toBe('Deps check');
  });

  it("an agent cannot rename a routine's session", async () => {
    const { channel, schedule } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, scheduleId: schedule, body: 'Routine · Morning dependency audit\n\nday one' });
    const r = await send(rex, { type: 'thread.update', workspace: 'ws_acme', threadId, title: 'Dependency check-in' });
    expect(r.status).toBe(409);
    expect((await j(r)).code).toBe('THREAD_ALREADY_TITLED');
    expect(titleOf(threadId)).toBe('Morning dependency audit');
  });

  it('a thread that no schedule opened keeps the title of its first message, and the orchestrator still names it', async () => {
    const { channel } = await armRoutine();
    const threadId = crypto.randomUUID();
    await post(george, { channel, threadId, body: 'Why does the drawer trap focus on iPad?' });
    expect(titleOf(threadId)).toBe('Why does the drawer trap focus on iPad?');
    expect((await send(rex, { type: 'thread.update', workspace: 'ws_acme', threadId, title: 'iPad focus trap' })).status).toBe(200);
    expect(titleOf(threadId)).toBe('iPad focus trap');
  });
});
