// schedules (marketing-channel plan §4.6): humans arm, agents propose; arming is THE
// deep-funnel paywall (free → PLAN_LIMIT 402 with the full-powers upsell); claiming a due
// run is a run_count CAS so two daemons never double-fire (the ship-stage counter lesson).
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

const base = { type: 'schedule.create', title: 'Daily drafts', prompt: 'Draft one post from the narrative pillars.', cadence: 'weekdays', atTime: '09:00', tz: 'UTC' };
type SchedRow = { id: string; title: string; cadence: string; runCount: number; payload: Record<string, unknown> };
const schedRow = (s: MemoryStore, id: string): SchedRow =>
  (s as unknown as { schedules: SchedRow[] }).schedules.find((x) => x.id === id)!;

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('schedule.create — humans arm, Team unlocks', () => {
  it('FREE workspace → PLAN_LIMIT 402 (the deep-funnel paywall moment)', async () => {
    const channel = await makeRoom();
    const res = await send(george, { ...base, channel });
    expect(res.status).toBe(402);
    expect(String((await j(res)).error ?? '')).toMatch(/Team/);
  });

  it('agents can NOT arm — they propose (HUMAN_ONLY), even on Cloud', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    expect((await send(plume, { ...base, channel })).status).toBe(403);
  });

  it('a Cloud human arms a recurring schedule; the server computes next_run_at', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const r = await j(await send(george, { ...base, channel }));
    expect(r.scheduleId).toBeTruthy();
    expect(new Date(r.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("'once' needs a future runAt", async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    expect((await send(george, { type: 'schedule.create', channel, title: 'Launch thread', prompt: 'Draft it.', cadence: 'once' })).status).toBe(422);
    expect((await send(george, { type: 'schedule.create', channel, title: 'Launch thread', prompt: 'Draft it.', cadence: 'once', runAt: '2020-01-01T00:00:00Z' })).status).toBe(422);
    const r = await send(george, { type: 'schedule.create', channel, title: 'Launch thread', prompt: 'Draft it.', cadence: 'once', runAt: new Date(Date.now() + 3600e3).toISOString() });
    expect(r.status).toBe(200);
  });
});

describe('schedule.claim_run — the counter CAS', () => {
  it('exactly one claimer wins a run; the stale counter loses without error', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    const next = new Date(Date.now() + 86_400e3).toISOString();
    const a = await j(await send(plume, { type: 'schedule.claim_run', schedule: scheduleId, runCount: 0, nextRunAt: next }));
    const b = await j(await send(plume, { type: 'schedule.claim_run', schedule: scheduleId, runCount: 0, nextRunAt: next }));
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(false);
  });

  it('a null nextRunAt retires the schedule to done', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { type: 'schedule.create', channel, title: 'One shot', prompt: 'Draft it.', cadence: 'once', runAt: new Date(Date.now() + 3600e3).toISOString() }));
    const a = await j(await send(plume, { type: 'schedule.claim_run', schedule: scheduleId, runCount: 0, nextRunAt: null }));
    expect(a.claimed).toBe(true);
    // a second claim on the done row loses (status guard)
    const b = await j(await send(plume, { type: 'schedule.claim_run', schedule: scheduleId, runCount: 1, nextRunAt: null }));
    expect(b.claimed).toBe(false);
  });
});

describe('schedule.mark_result — the fire’s outcome reaches the row', () => {
  it('writes the failure, clears it with null, from either lane (the claim’s own rule)', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    const seen: Array<string | null> = [];
    const orig = store.markScheduleResult.bind(store);
    store.markScheduleResult = async (id, err, mk) => { seen.push(err); return orig(id, err, mk); };
    expect((await send(plume, { type: 'schedule.mark_result', schedule: scheduleId, error: 'no compute available — anthropic seats at their usage cap' })).status).toBe(200);
    expect((await send(george, { type: 'schedule.mark_result', schedule: scheduleId, error: null })).status).toBe(200);
    expect(seen).toEqual(['no compute available — anthropic seats at their usage cap', null]);
  });

  it('a missing schedule is NOT_FOUND; an over-length reason never reaches the row', async () => {
    expect((await send(plume, { type: 'schedule.mark_result', schedule: '11111111-1111-1111-1111-111111111111', error: 'x' })).status).toBe(404);
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    expect((await send(plume, { type: 'schedule.mark_result', schedule: scheduleId, error: 'e'.repeat(600) })).status).toBe(400);
  });
});

describe('pause / delete — human-only management', () => {
  it('pause + delete round-trip; agents are refused', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    expect((await send(plume, { type: 'schedule.set_status', schedule: scheduleId, status: 'paused' })).status).toBe(403);
    expect((await send(george, { type: 'schedule.set_status', schedule: scheduleId, status: 'paused' })).status).toBe(200);
    expect((await send(george, { type: 'schedule.delete', schedule: scheduleId })).status).toBe(200);
    expect((await send(george, { type: 'schedule.delete', schedule: scheduleId })).status).toBe(404);
  });
});

describe('schedule.update — edit + reschedule, human-only', () => {
  it('rewrites title/prompt/cadence and recomputes next_run_at; run_count untouched; agents refused', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    const before = schedRow(store, scheduleId);
    const upd = { type: 'schedule.update', schedule: scheduleId, title: 'Weekly recap', prompt: 'Draft the weekly recap thread.', cadence: 'weekly', atTime: '14:00', tz: 'UTC', weekday: 3 };
    expect((await send(plume, upd)).status).toBe(403);
    expect((await send(george, upd)).status).toBe(200);
    const after = schedRow(store, scheduleId);
    expect(after.title).toBe('Weekly recap');
    expect(after.cadence).toBe('weekly');
    expect(after.payload).toMatchObject({ prompt: 'Draft the weekly recap thread.' });
    expect(after.runCount).toBe(before.runCount); // an edit is not a claim
  });

  it('a one-shot edit needs a future runAt', async () => {
    const channel = await makeRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const { scheduleId } = await j(await send(george, { ...base, channel }));
    expect((await send(george, { type: 'schedule.update', schedule: scheduleId, title: 'x', prompt: 'y', cadence: 'once', runAt: '2020-01-01T00:00:00Z' })).status).toBe(422);
    expect((await send(george, { type: 'schedule.update', schedule: scheduleId, title: 'x', prompt: 'y', cadence: 'once', runAt: new Date(Date.now() + 3600e3).toISOString() })).status).toBe(200);
  });
});
