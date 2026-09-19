// marketing.setup (marketing-channel plan §4.3): point a marketing room at the product.
// HUMAN_ONLY; FREE on every plan (round 2 — the paywall sits on schedule.*/content.*).
// Round 4: the bootstrap is a CONVERSATION, not a task — setup writes the profile onto
// channels.marketing, mints the bootstrap thread id, and arms a one-shot internal
// schedule (gate-bypassing on purpose) that the daemon runs as a chat thread. No task.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

// the daemon reads these fields off the replica; the memory store mirrors pg's payload
type ScheduleRow = { channelId: string; title: string; cadence: string; status: string; payload: Record<string, unknown> };
const schedulesOf = (s: MemoryStore): ScheduleRow[] => (s as unknown as { schedules: ScheduleRow[] }).schedules;

function send(actor: Actor, body: unknown) {
  return app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

async function makeMarketingRoom(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
  await send(george, { type: 'channel.set_kind', channel: chan.channelId, kind: 'marketing' });
  return chan.channelId as string;
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('marketing.setup — the HQ front door (free, human-only, conversational)', () => {
  it('agents can NOT run setup — even the orchestrator', async () => {
    const channel = await makeMarketingRoom();
    const res = await send(rex, { type: 'marketing.setup', channel, website: 'neuramesh.app' });
    expect(res.status).toBe(403);
  });

  it('setup stores the profile and mints the bootstrap CONVERSATION — a thread id + one-shot schedule, never a task', async () => {
    const channel = await makeMarketingRoom();
    const r = await j(await send(george, { type: 'marketing.setup', channel, website: 'neuramesh.app', focus: ['social', 'content'], goal: 'first 100 users' }));
    expect(r.channelId).toBe(channel);
    expect(r.task).toBeUndefined(); // round 4 — onboarding analysis is not board work
    expect(r.threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const boot = schedulesOf(store).find((s) => s.channelId === channel);
    expect(boot).toBeTruthy();
    expect(boot!.cadence).toBe('once');
    expect(boot!.status).toBe('active');
    expect(boot!.payload['bootstrap']).toBe(true);
    expect(boot!.payload['threadId']).toBe(r.threadId);
    expect(String(boot!.payload['prompt'])).toContain('neuramesh.app');
    // the thread is pre-born TITLED — the header never flashes the raw-message heuristic
    const th = store.threads.find((t) => t.id === r.threadId);
    expect(th?.title).toBe('Brand foundation');
  });

  it('the bootstrap schedule bypasses the plan gate — a FREE workspace still gets the analysis', async () => {
    const channel = await makeMarketingRoom();
    // (default MemoryStore plan is free; schedule.create would 402 here — setup must not)
    const res = await send(george, { type: 'marketing.setup', channel, website: 'flowe.app' });
    expect(res.status).toBe(200);
    expect(schedulesOf(store).some((s) => s.channelId === channel && s.payload['bootstrap'] === true)).toBe(true);
  });

  it('focus defaults to social+content; setup is re-runnable (the profile is a plain overwrite)', async () => {
    const channel = await makeMarketingRoom();
    const first = await j(await send(george, { type: 'marketing.setup', channel }));
    const boot = schedulesOf(store).find((s) => s.payload['threadId'] === first.threadId);
    expect(String(boot!.payload['prompt'])).toContain('social, content');
    const again = await j(await send(george, { type: 'marketing.setup', channel, website: 'flowe.app', focus: ['ads'] }));
    expect(again.ok).toBe(true);
    expect(again.threadId).not.toBe(first.threadId); // a re-run opens a fresh conversation
  });

  it('a bogus focus value is rejected at the schema boundary', async () => {
    const channel = await makeMarketingRoom();
    const res = await send(george, { type: 'marketing.setup', channel, focus: ['growth-hacking'] });
    expect(res.status).toBe(400);
  });

  it('an unknown channel is NOT_FOUND', async () => {
    const res = await send(george, { type: 'marketing.setup', channel: 'ffffffff-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('artifact.create drops a plain channel doc — the bootstrap library path', async () => {
    const channel = await makeMarketingRoom();
    const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };
    const r = await j(await send(plume, { type: 'artifact.create', channel, kind: 'doc', name: 'brand-guidelines.md', inlineContent: '# Brand guidelines\nVoice: plain, warm.', mime: 'text/markdown' }));
    expect(r.ok).toBe(true);
    expect(r.artifactId).toBeTruthy();
    const bad = await send(plume, { type: 'artifact.create', channel: 'ffffffff-0000-0000-0000-000000000000', kind: 'doc', name: 'x.md', inlineContent: 'x' });
    expect(bad.status).toBe(404);
  });
});

describe('marketing.setup with releases — step 5 plants the routines (release-drafts plan §4.7)', () => {
  const rel = { repoId: 'r-oss', slug: 'neuramesh-ai/neuramesh-oss', now: true, watch: true, at: '09:00', tz: 'UTC' };
  it('on Team: the free one-shot and the daily watch, both routines that carry the repository', async () => {
    const channel = await makeMarketingRoom();
    await store.setWorkspacePlan('ws_acme', { plan: 'cloud' });
    const r = await j(await send(george, { type: 'marketing.setup', channel, website: 'https://neuramesh.app', focus: ['social'], releases: rel }));
    expect(r.releases).toEqual({ now: true, watch: 'armed' });
    const mine = schedulesOf(store).filter((s) => s.channelId === channel && String(s.title).startsWith('Release drafts'));
    expect(mine.map((s) => s.cadence).sort()).toEqual(['daily', 'once']);
    for (const s of mine) {
      expect(s.payload['routine']).toBe(true);
      expect(s.payload['prompt']).toBe('Run the release drafts playbook.');
      expect((s.payload['release'] as { repo: string; slug: string }).repo).toBe('r-oss');
    }
    const daily = mine.find((s) => s.cadence === 'daily')!;
    expect((daily.payload['release'] as { cursor: { tag: null }; log: unknown[] }).cursor.tag).toBeNull();
    expect((mine.find((s) => s.cadence === 'once')!.payload['release'] as { latest: boolean }).latest).toBe(true);
    // the profile remembers the answer through the completing command itself, never only the step write
    const ch = (store as unknown as { channels: Array<{ id: string; marketing?: Record<string, unknown> }> }).channels.find((c) => c.id === channel)!;
    expect(ch.marketing?.['releases']).toEqual({ repoId: 'r-oss', slug: 'neuramesh-ai/neuramesh-oss', now: true, watch: true });
  });
  it('on Free: the one-shot runs, the watch is refused by name, nothing else changes', async () => {
    const channel = await makeMarketingRoom();
    const r = await j(await send(george, { type: 'marketing.setup', channel, website: 'https://neuramesh.app', releases: rel }));
    expect(r.releases).toEqual({ now: true, watch: 'plan_limit' });
    const mine = schedulesOf(store).filter((s) => s.channelId === channel && String(s.title).startsWith('Release drafts'));
    expect(mine.map((s) => s.cadence)).toEqual(['once']);
  });
  it('a watch with no repository is refused, and a switched-off step plants nothing', async () => {
    const channel = await makeMarketingRoom();
    expect((await send(george, { type: 'marketing.setup', channel, releases: { now: true, watch: false } })).status).toBe(422);
    const r = await j(await send(george, { type: 'marketing.setup', channel, releases: { repoId: 'r-oss', now: false, watch: false } }));
    expect(r.releases).toBeUndefined();
    expect(schedulesOf(store).filter((s) => s.channelId === channel && String(s.title).startsWith('Release drafts'))).toEqual([]);
  });
});
