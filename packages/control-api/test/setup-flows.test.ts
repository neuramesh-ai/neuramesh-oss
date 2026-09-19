// Setup flows end to end at the command layer (2026-08-09, shared/setupflows.ts):
// a marketing room's creation plants ONE setup task; per-step writes make abandonment a
// pause; completing setup finishes the task; cancel is the opt-out; the backfill converges.
import type { Actor, Task } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const tasksOf = (s: MemoryStore): Task[] => [...(s as unknown as { tasks: Map<string, Task> }).tasks.values()];
const setupTaskIn = (s: MemoryStore, channelSlug: string): Task | undefined =>
  tasksOf(s).find((t) => t.kind === 'setup' && t.channel === channelSlug);
const channelsOf = (s: MemoryStore) => (s as unknown as { channels: Array<{ id: string; slug: string; kind?: string; marketing?: Record<string, unknown> }> }).channels;

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

async function makeMarketingRoom(slug = 'marketing'): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug }));
  await send(george, { type: 'channel.set_kind', channel: chan.channelId, kind: 'marketing' });
  return chan.channelId as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('the setup task exists because the room does', () => {
  it('becoming a marketing room plants ONE open setup task — flipping kind twice does not double it', async () => {
    const channel = await makeMarketingRoom();
    await send(george, { type: 'channel.set_kind', channel, kind: 'build' });
    await send(george, { type: 'channel.set_kind', channel, kind: 'marketing' });
    const setups = tasksOf(store).filter((t) => t.kind === 'setup');
    expect(setups).toHaveLength(1);
    expect(setups[0]!.state).toBe('todo');
    expect(setups[0]!.title).toBe('Set up your marketing HQ');
  });

  it('a build room gets nothing — no flow, no task', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Eng' }));
    await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'build' }));
    expect(tasksOf(store).filter((t) => t.kind === 'setup')).toHaveLength(0);
  });
});

describe('setup.step — the per-step write that makes abandonment a pause', () => {
  it('is HUMAN_ONLY, like the wizard it persists', async () => {
    const channel = await makeMarketingRoom();
    const res = await send(rex, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'product', value: 'flowe.app' });
    expect(res.status).toBe(403);
  });

  it('writes the step and moves the task todo → in_progress; an unknown flow/step is refused', async () => {
    const channel = await makeMarketingRoom();
    const ok = await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'product', value: 'flowe.app' });
    expect(ok.status).toBe(200);
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    expect(ch.marketing?.['website']).toBe('flowe.app');
    expect(ch.marketing?.['setup_progress']).toEqual({ flow: 'marketing.v1', step: 'product' });
    expect(setupTaskIn(store, ch.slug)?.state).toBe('in_progress');
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v9', step: 'product' })).status).toBe(404);
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'nope' })).status).toBe(404);
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'focus', value: ['skywriting'] })).status).toBe(422);
  });

  it('completing setup (marketing.setup) FINISHES the task and keeps the per-step writes', async () => {
    const channel = await makeMarketingRoom();
    await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'product', value: 'flowe.app' });
    await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'goal', value: 'first 1000' });
    const r = await send(george, { type: 'marketing.setup', channel, website: 'flowe.app', focus: ['social'] });
    expect(r.status).toBe(200);
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    expect(ch.marketing?.['goal']).toBe('first 1000'); // merged, not wiped by completion
    expect(ch.marketing?.['setup_at']).toBeTruthy();
    expect(setupTaskIn(store, ch.slug)?.state).toBe('done');
  });
});

describe('the lean life and the backfill', () => {
  it('no agent can offer or claim a setup task — refused structurally, not by prompt', async () => {
    const channel = await makeMarketingRoom();
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    const t = setupTaskIn(store, ch.slug)!;
    const offer = await send(rex, { type: 'task.offer', taskId: t.id, agentName: 'rex' });
    expect(offer.status).toBeGreaterThanOrEqual(400);
    const claim = await send(rex, { type: 'task.claim', taskId: t.id });
    expect(claim.status).toBeGreaterThanOrEqual(400);
  });

  it('cancel is the opt-out; the slot stays used, so cancelling is never "ask me again"', async () => {
    const channel = await makeMarketingRoom();
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    const t = setupTaskIn(store, ch.slug)!;
    const res = await send(george, { type: 'task.cancel', taskId: t.id });
    expect(res.status).toBe(200);
    expect(setupTaskIn(store, ch.slug)?.state).toBe('closed');
    // re-flip the kind: the closed row holds the unique slot — no fresh nag appears
    await send(george, { type: 'channel.set_kind', channel, kind: 'build' });
    await send(george, { type: 'channel.set_kind', channel, kind: 'marketing' });
    expect(tasksOf(store).filter((x) => x.kind === 'setup')).toHaveLength(1);
  });

  it('setup.backfill creates for untouched rooms only, idempotently, and reports the count', async () => {
    const channel = await makeMarketingRoom();
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    // simulate the pre-flows world: room exists, no setup task (delete the planted one)
    const planted = setupTaskIn(store, ch.slug)!;
    (store as unknown as { tasks: Map<string, Task> }).tasks.delete(planted.id);
    const first = await j(await send(george, { type: 'setup.backfill', workspace: 'ws_acme' }));
    expect(first.created).toBe(1);
    const again = await j(await send(george, { type: 'setup.backfill', workspace: 'ws_acme' }));
    expect(again.created).toBe(0); // the task now exists — converged
    // a CONFIGURED room is left alone (the release-day question)
    await send(george, { type: 'marketing.setup', channel, website: 'flowe.app' });
    const t2 = setupTaskIn(store, ch.slug)!;
    (store as unknown as { tasks: Map<string, Task> }).tasks.delete(t2.id);
    const third = await j(await send(george, { type: 'setup.backfill', workspace: 'ws_acme' }));
    expect(third.created).toBe(0);
  });

  it('a plain worker cannot run the backfill', async () => {
    const worker: Actor = { kind: 'agent', id: 'patch', role: 'worker' };
    expect((await send(worker, { type: 'setup.backfill', workspace: 'ws_acme' })).status).toBe(403);
  });
});

describe('the releases step (step 5) writes an object, and only that step does', () => {
  it('stores the choices on the profile and keeps the marker', async () => {
    const channel = await makeMarketingRoom('mk5');
    const value = { repoId: 'r-oss', slug: 'neuramesh-ai/neuramesh-oss', now: true, watch: false };
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'releases', value })).status).toBe(200);
    const ch = channelsOf(store).find((c) => c.id === channel)!;
    expect(ch.marketing?.['releases']).toEqual(value);
    expect(ch.marketing?.['setup_progress']).toEqual({ flow: 'marketing.v1', step: 'releases' });
  });
  it('a text value on the releases step, or an object on another step, is refused', async () => {
    const channel = await makeMarketingRoom('mk5b');
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'releases', value: 'r-oss' })).status).toBe(422);
    expect((await send(george, { type: 'setup.step', channel, flow: 'marketing.v1', step: 'product', value: { now: true } })).status).toBe(422);
  });
});
