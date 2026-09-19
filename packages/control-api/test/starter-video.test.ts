// The video rung (docs/design/video-rung-2026-09, issue #539): the door's guards in order, the
// price, the submit to a fake fal queue, the films row, the pending draft, and the cron's three
// endings (done, failed with a refund, timed out with a refund). Memory store, a fake ledger.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Ledger } from '../src/credits';
import { filmsDue } from '../src/starter-video';
import { MemoryStore } from '../src/store';
import { tierFor, videoTiers } from '../src/video-registry';

const george: Actor = { kind: 'human', id: 'george' };
const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 1, 2, 3, 4]);
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

/** a ledger with a balance and a memory of what it was asked */
function fakeLedger(remainingMicros: number) {
  const calls: Array<Record<string, unknown>> = [];
  let remaining = remainingMicros;
  const ledger: Ledger = {
    balance: async () => ({ grantedMicros: remaining, spentMicros: 0, purchasedMicros: 0, purchasedSpentMicros: 0, remainingMicros: remaining, grantRemainingMicros: remaining, purchasedRemainingMicros: 0, periodStart: '2026-09-01' }),
    usage: async () => ({ day: '2026-09-19', minutes: 0, activeSeconds: 0, modelCalls: 0, modelMicros: 0, machineMicros: 0, videoClips: 0, videoMicros: 0 }),
    spend: async () => ({ remainingMicros: remaining }),
    spendFilm: async (_w, micros, clip) => { calls.push({ op: 'spendFilm', micros, seconds: clip.seconds }); if (remaining < micros) return null; remaining -= micros; return { remainingMicros: remaining, grantMicros: micros, purchasedMicros: 0 }; },
    refundFilm: async (_w, split, note) => { calls.push({ op: 'refundFilm', micros: split.grantMicros + split.purchasedMicros, note }); remaining += split.grantMicros + split.purchasedMicros; },
  };
  return { ledger, calls, remaining: () => remaining };
}

/** fal's queue, faked: the submit answers a request id, the status walks queued → running → done, the result names a clip */
function fakeFal(opts: { submit?: 'ok' | 'gone' | 'refuse'; fail?: string; polls?: number } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  let polls = 0;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (init?.method === 'POST' && url.startsWith('https://queue.fal.run/')) {
      if (opts.submit === 'gone') return json({ detail: 'Not Found' }, 404);
      if (opts.submit === 'refuse') return json({ detail: [{ msg: 'prompt too long' }] }, 422);
      return json({ request_id: 'req-1', status_url: 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-1/status', response_url: 'https://queue.fal.run/bytedance/seedance-2.0/requests/req-1' }, 200);
    }
    // the request endpoints hang off the app base (found live: the sub-path form answers 405)
    if (url.includes('/text-to-video/requests/')) return json({ detail: 'Method Not Allowed' }, 405);
    if (url.endsWith('/requests/req-1/status')) {
      polls += 1;
      if (opts.fail) return json({ status: 'COMPLETED', error: opts.fail, error_type: 'content_policy' });
      if (polls < (opts.polls ?? 2)) return json({ status: polls === 1 ? 'IN_QUEUE' : 'IN_PROGRESS', queue_position: 1 });
      return json({ status: 'COMPLETED' });
    }
    if (url.endsWith('/requests/req-1')) return json({ video: { url: 'https://v3.fal.media/files/x/clip.mp4', content_type: 'video/mp4', file_name: 'clip.mp4', file_size: MP4.length }, seed: 1 });
    if (url.endsWith('/clip.mp4')) return new Response(new Uint8Array(MP4), { status: 200, headers: { 'content-type': 'video/mp4' } });
    return json({ detail: 'unexpected call' }, 500);
  };
  return { fetchFn, calls };
}

const ENV = { FAL_KEY: 'fal-key', NM_VIDEO_TIERS: 'starter=seedance-2.0-fast,xpress=minimax-h3,premium=seedance-2.0', CRON_SECRET: 'cron' } as NodeJS.ProcessEnv;

describe('the registry and the tiers', () => {
  it('maps the env list to the tiers in the person\'s order, drops an unknown key, and prices a clip at cost', () => {
    const tiers = videoTiers({ FAL_KEY: 'k', NM_VIDEO_TIERS: 'premium=seedance-2.0,starter=seedance-2.0-fast,xpress=nope' });
    expect(tiers.map((t) => [t.tier, t.model.key, t.credits])).toEqual([['starter', 'seedance-2.0-fast', 194], ['premium', 'seedance-2.0', 243]]);
    expect(videoTiers({ NM_VIDEO_TIERS: 'starter=seedance-2.0-fast' })).toEqual([]); // no key, no lane
    const all = videoTiers(ENV);
    expect(all.map((t) => t.credits)).toEqual([194, 48, 243]);
    expect(tierFor(all, null)?.tier).toBe('starter');
    expect(tierFor(all, 'xpress')?.tier).toBe('xpress');
    expect(tierFor(all, 'bogus')?.tier).toBe('starter');
  });
});

describe('the door', () => {
  let store: MemoryStore;
  let app: ReturnType<typeof createApp>;
  let ws = '';
  let channel = '';
  let item = '';
  const send = (actor: Actor, path: string, body?: unknown, method = 'POST') => app.request(path, { method, headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  /** the real app with the door's deps swapped: a fake ledger, a fake fal, this test's env */
  const door = (ledger: Ledger, fetchFn: typeof fetch, env: NodeJS.ProcessEnv = ENV) => { app = createApp(store, { starterVideo: { ledger, env, fetchFn } }); };

  beforeEach(async () => {
    store = new MemoryStore();
    app = createApp(store);
    ({ workspaceId: ws } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: 'george' }, createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: 'george' }), target: 'resource/workspace/acme', workspace: 'acme', payload: {} })));
    const proj = await j(await send(george, '/v1/commands', { type: 'project.create', workspace: ws, name: 'Growth' }));
    ({ channelId: channel } = await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: ws, project: proj.projectId, slug: 'marketing' })));
    ({ itemId: item } = await j(await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'the caption', script: '[0:00-0:03] hook', imageBrief: 'phone in hand' })));
  });

  it('GET /v1/starter/video: what the server films on, in credits, and the workspace pick', async () => {
    door(fakeLedger(5_000_000).ledger, fakeFal().fetchFn);
    const r = await j(await send(george, `/v1/starter/video?workspace=${ws}`, undefined, 'GET'));
    expect(r.served).toBe(true);
    expect(r.tier).toBe('starter');
    expect(r.tiers.map((t: { tier: string; model: string; credits: number }) => [t.tier, t.model, t.credits])).toEqual([['starter', 'Seedance 2.0', 194], ['xpress', 'MiniMax H3', 48], ['premium', 'Seedance 2.0 Standard', 243]]);
    // the pick is a Pro setting: Free is refused, Pro picks, an agent never may
    expect(r.canPick).toBe(false);
    expect((await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, videoTier: 'premium' })).status).toBe(403);
    (store as unknown as { plans: Map<string, string> }).plans.set(ws, 'cloud');
    expect((await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, videoTier: 'premium' })).status).toBe(200);
    const pro = await j(await send(george, `/v1/starter/video?workspace=${ws}`, undefined, 'GET'));
    expect([pro.tier, pro.canPick]).toEqual(['premium', true]);
    expect((await send(plume, '/v1/commands', { type: 'workspace.update', workspace: ws, videoTier: 'xpress' })).status).toBe(403);
  });

  it('refuses before it spends: NO_CREDITS first, then UNAVAILABLE without a lane, NOT_FOUND on a foreign draft', async () => {
    const fal = fakeFal();
    const empty = fakeLedger(0);
    door(empty.ledger, fal.fetchFn);
    const r = await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    expect(r.status).toBe(402);
    expect((await j(r)).code).toBe('NO_CREDITS');
    expect(fal.calls).toEqual([]); // the guard ran before any fal call
    expect(empty.calls).toEqual([]);
    // no lane on this server (no key)
    door(fakeLedger(5_000_000).ledger, fal.fetchFn, { NM_VIDEO_TIERS: ENV['NM_VIDEO_TIERS'] } as NodeJS.ProcessEnv);
    expect((await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' })).status).toBe(503);
    // a draft that is not this workspace's
    door(fakeLedger(5_000_000).ledger, fal.fetchFn);
    expect((await send(george, '/v1/starter/film', { workspace: ws, item: '00000000-0000-4000-8000-000000000009', prompt: 'a vertical clip of the hook' })).status).toBe(404);
  });

  it('charges the clip at cost, submits the tier\'s model with its inputs, writes the row, and marks the draft pending; a second press is refused', async () => {
    const fal = fakeFal();
    const led = fakeLedger(5_000_000);
    door(led.ledger, fal.fetchFn);
    const r = await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    expect(r.status).toBe(202);
    const body = await j(r);
    expect(body.credits).toBe(194);
    expect(body.tier.model).toBe('Seedance 2.0');
    expect(led.calls[0]).toEqual({ op: 'spendFilm', micros: 1_940_000, seconds: 8 });
    expect(fal.calls[0]!.url).toBe('https://queue.fal.run/bytedance/seedance-2.0/fast/text-to-video');
    expect(fal.calls[0]!.body).toEqual({ prompt: 'a vertical clip of the hook', resolution: '720p', duration: '8', aspect_ratio: '9:16', generate_audio: true });
    const [row] = store.films.rows;
    expect(row).toMatchObject({ itemId: item, tier: 'starter', model: 'seedance-2.0-fast', requestId: 'req-1', micros: 1_940_000, status: 'queued' });
    expect((store as unknown as { contentItems: Array<{ id: string; videoPending?: boolean; mediaId?: string | null; videoMeta?: unknown }> }).contentItems.find((x) => x.id === item)).toMatchObject({ videoPending: true });
    expect((await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'the same hook again' })).status).toBe(409);
  });

  it('a submit fal refuses refunds the charge; an endpoint the key cannot reach answers UNAVAILABLE', async () => {
    const led = fakeLedger(5_000_000);
    door(led.ledger, fakeFal({ submit: 'refuse' }).fetchFn);
    const r = await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    expect(r.status).toBe(502);
    expect(led.calls.map((c) => c['op'])).toEqual(['spendFilm', 'refundFilm']);
    expect(led.remaining()).toBe(5_000_000);
    door(led.ledger, fakeFal({ submit: 'gone' }).fetchFn);
    expect((await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' })).status).toBe(503);
    expect(store.films.rows).toEqual([]);
  });

  it('the cron: queued → running → done lands the clip on the draft with its facts; a failure and a timeout refund', async () => {
    const fal = fakeFal({ polls: 3 });
    const led = fakeLedger(5_000_000);
    door(led.ledger, fal.fetchFn);
    await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    const t0 = Date.parse(store.films.rows[0]!.createdAt);
    const pass = () => filmsDue(store, { ledger: led.ledger, env: ENV, fetchFn: fal.fetchFn, now: () => t0 + 1000 });
    expect((await pass()).map((r) => r.outcome)).toEqual(['queued']);
    expect((await pass()).map((r) => r.outcome)).toEqual(['running']);
    expect(store.films.rows[0]!.status).toBe('running');
    expect((await pass()).map((r) => r.outcome)).toEqual(['done']);
    const it = (store as unknown as { contentItems: Array<{ id: string; videoPending?: boolean; mediaId?: string | null; videoMeta?: unknown }> }).contentItems.find((x) => x.id === item)!;
    expect(it.videoPending).toBe(false);
    expect(it.mediaId).toBeTruthy();
    expect(it.videoMeta).toMatchObject({ tier: 'starter', model: 'Seedance 2.0', seconds: 8, credits: 194 });
    expect((await store.contentMediaBytes(it.mediaId!))?.mime).toBe('video/mp4');
    expect(store.films.rows[0]!.status).toBe('done');
    expect(await pass()).toEqual([]); // nothing open

    // a film fal declines: the credits come back, the reason lands on the card
    ({ itemId: item } = await j(await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'two', script: '[0:00-0:03] hook' })));
    const bad = fakeFal({ fail: 'content policy' });
    door(led.ledger, bad.fetchFn);
    await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    const before = led.remaining();
    expect((await filmsDue(store, { ledger: led.ledger, env: ENV, fetchFn: bad.fetchFn })).map((r) => r.outcome)).toEqual(['failed: content policy']);
    expect(led.remaining()).toBe(before + 1_940_000);
    expect((store as unknown as { contentItems: Array<{ id: string; videoPending?: boolean; mediaId?: string | null; videoMeta?: unknown }> }).contentItems.find((x) => x.id === item)).toMatchObject({ videoPending: false });
    expect(store.films.rows[1]!.status).toBe('failed');

    // a film nobody answers for twelve minutes
    ({ itemId: item } = await j(await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'three', script: '[0:00-0:03] hook' })));
    const slow = fakeFal({ polls: 99 });
    door(led.ledger, slow.fetchFn);
    await send(george, '/v1/starter/film', { workspace: ws, item, prompt: 'a vertical clip of the hook' });
    const t1 = Date.parse(store.films.rows[2]!.createdAt);
    expect((await filmsDue(store, { ledger: led.ledger, env: ENV, fetchFn: slow.fetchFn, now: () => t1 + 13 * 60_000 })).map((r) => r.outcome)).toEqual(['failed: the film took longer than twelve minutes']);
    expect(led.calls.filter((c) => c['op'] === 'refundFilm')).toHaveLength(2);
  });

  it('the frame: a draft that names a shelf image films on the reference lane with it; a model without one films the text lane and says so; an unknown name is refused where the draft is written', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    // the shelf: a real screenshot uploaded to the room (the chat attachment lane, 0048)
    expect((await send(george, '/v1/artifacts', { id: '00000000-0000-4000-8000-00000000aa01', workspace: ws, channel, messageId: '00000000-0000-4000-8000-00000000bb01', kind: 'screenshot', name: 'App-Home.png', mime: 'image/png', inlineContent: PNG, sizeBytes: 70 })).status).toBe(200);
    // an unknown name never reaches the draft
    const bad = await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'four', script: '[0:00-0:03] hook', frame: 'nope.png' });
    expect(bad.status).toBe(404);
    expect((await j(bad)).error).toMatch(/no image named "nope.png"/);
    // the name is stored as the shelf spells it, whichever case the agent wrote
    const { itemId: framed } = await j(await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'four', script: '[0:00-0:03] hook', frame: 'app-home.png' }));
    expect((await store.contentItemMedia(framed))?.frame).toBe('App-Home.png');
    const fal = fakeFal({ polls: 2 });
    const led = fakeLedger(5_000_000);
    door(led.ledger, fal.fetchFn);
    const r = await send(george, '/v1/starter/film', { workspace: ws, item: framed, prompt: 'a vertical clip of the hook' });
    expect(r.status).toBe(202);
    expect(await j(r)).toMatchObject({ frame: 'App-Home.png', frameUsed: true, credits: 194 }); // the same price as the text lane
    expect(fal.calls[0]!.url).toBe('https://queue.fal.run/bytedance/seedance-2.0/fast/reference-to-video');
    expect(fal.calls[0]!.body).toMatchObject({ image_urls: [PNG], aspect_ratio: '9:16', duration: '8' });
    expect((fal.calls[0]!.body as { prompt: string }).prompt).toMatch(/^a vertical clip of the hook The product on screen is @Image1/);
    expect(store.films.rows.at(-1)).toMatchObject({ itemId: framed, endpoint: 'bytedance/seedance-2.0/fast/reference-to-video', frame: 'App-Home.png', frameUsed: true });
    const t0 = Date.parse(store.films.rows.at(-1)!.createdAt);
    await filmsDue(store, { ledger: led.ledger, env: ENV, fetchFn: fal.fetchFn, now: () => t0 + 1000 });
    await filmsDue(store, { ledger: led.ledger, env: ENV, fetchFn: fal.fetchFn, now: () => t0 + 1000 });
    const items = (store as unknown as { contentItems: Array<{ id: string; videoMeta?: unknown; frame?: string | null }> }).contentItems;
    expect(items.find((x) => x.id === framed)!.videoMeta).toMatchObject({ frame: 'App-Home.png', frameUsed: true });
    // the xpress tier (MiniMax H3) has no reference lane: the text lane, the prompt clean of @Image1, the row says the frame was not used
    (store as unknown as { plans: Map<string, string> }).plans.set(ws, 'cloud');
    await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, videoTier: 'xpress' });
    const { itemId: framed2 } = await j(await send(plume, '/v1/commands', { type: 'content.create', channel, platform: 'x', body: 'five', script: '[0:00-0:03] hook', frame: 'App-Home.png' }));
    const fal2 = fakeFal();
    door(led.ledger, fal2.fetchFn);
    expect(await j(await send(george, '/v1/starter/film', { workspace: ws, item: framed2, prompt: 'a vertical clip of the hook' }))).toMatchObject({ frame: 'App-Home.png', frameUsed: false });
    expect(fal2.calls[0]!.url).toBe('https://queue.fal.run/minimax/h3/text-to-video');
    expect((fal2.calls[0]!.body as { prompt: string; image_urls?: unknown }).prompt).toBe('a vertical clip of the hook');
    expect((fal2.calls[0]!.body as { image_urls?: unknown }).image_urls).toBeUndefined();
    // a revision drops the frame with null, and refuses a name the shelf does not hold
    expect((await send(plume, '/v1/commands', { type: 'content.revise', item: framed2, frame: 'missing.png' })).status).toBe(404);
    expect((await send(plume, '/v1/commands', { type: 'content.revise', item: framed2, frame: null })).status).toBe(200);
    expect((await store.contentItemMedia(framed2))?.frame).toBe(null);
    // a frame change makes the old film stale, the way a new script does: the record goes and the card films again
    expect((await send(plume, '/v1/commands', { type: 'content.revise', item: framed, frame: 'App-Home.png' })).status).toBe(200);
    expect(items.find((x) => x.id === framed)!.videoMeta).toBe(null);
  });

  it('the cron door wants the secret', async () => {
    expect((await app.request('/internal/films-due')).status).toBe(403);
  });
});
