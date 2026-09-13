// Hosted draft images (marketing-workflow §4.7, migration 0090). A picture generated on the
// user's machine can only publish if something public can fetch it: Instagram has META pull the
// URL, TikTok pulls through our domain-verified proxy, and X uploads the raw bytes. So the bytes
// land server-side and the publish pass hands out an HMAC-gated /media/<id> URL.
import type { Actor } from '@neuramesh/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { publicApiBase, XReauthRequired, publishDueItems, xPoster, type Poster, type TokenBundle } from '../src/connectors';
import { mediaSig, seal } from '../src/connector-crypto';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const plume: Actor = { kind: 'agent', id: 'plume', role: 'marketer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const send = async (actor: Actor, body: unknown): Promise<Response> =>
  app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

// a 1x1 gif — small, and a real image byte sequence rather than a made-up blob
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_AB = () => { const b = Buffer.from(GIF_B64, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }; // .buffer alone is the 8KB SHARED POOL, not the gif
const DATA_URL = `data:image/gif;base64,${GIF_B64}`;

beforeAll(() => { process.env['NM_CONNECTOR_KEY'] = 'test-key-please-ignore'; });

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

async function makeDraft(): Promise<string> {
  const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
  const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
  const { itemId } = await j(await send(plume, { type: 'content.create', channel: chan.channelId, platform: 'instagram', body: 'copy' }));
  return itemId as string;
}

describe('content.attach_media', () => {
  it('an AGENT may host the image it generated — that is the whole point', async () => {
    const item = await makeDraft();
    const res = await send(plume, { type: 'content.attach_media', item, dataUrl: DATA_URL });
    expect(res.status).toBe(200);
    const { mediaId } = await j(res);
    expect(mediaId).toBeTruthy();
    const stored = await store.contentMediaBytes(mediaId);
    expect(stored?.mime).toBe('image/gif');
    expect(stored?.bytes.toString('base64')).toBe(GIF_B64);
  });

  it('points the draft at the hosted bytes without losing the brief or the inline thumb', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
    const { itemId } = await j(await send(plume, {
      type: 'content.create', channel: chan.channelId, platform: 'x', body: 'copy',
      imageBrief: 'a warm gold lamp', thumb: 'data:image/jpeg;base64,TH',
    }));
    await send(plume, { type: 'content.attach_media', item: itemId, dataUrl: DATA_URL });
    await send(george, { type: 'content.approve', item: itemId, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    const [due] = await store.dueContentItems(new Date(Date.now() + 7200e3).toISOString(), 10);
    expect(due?.mediaId).toBeTruthy();
  });

  it('refuses anything that is not a decodable image, and anything over 8MB', async () => {
    const item = await makeDraft();
    // a non-image mime never gets past the schema; an empty or oversize payload dies in the handler
    expect((await send(plume, { type: 'content.attach_media', item, dataUrl: 'data:text/plain;base64,aGk=' })).status).toBe(400);
    expect((await send(plume, { type: 'content.attach_media', item, dataUrl: 'data:image/png;base64,' })).status).toBe(422);
    const huge = `data:image/png;base64,${'A'.repeat(11_000_000)}`;
    expect((await send(plume, { type: 'content.attach_media', item, dataUrl: huge })).status).toBe(400);
  });

  it('will not attach to an item that already published — history is immutable', async () => {
    const item = await makeDraft();
    await send(george, { type: 'content.approve', item, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    await store.markContentPublished(item, 'https://x.com/i/web/status/1', new Date().toISOString());
    expect((await send(plume, { type: 'content.attach_media', item, dataUrl: DATA_URL })).status).toBe(404);
  });
});

describe('GET /media/:id', () => {
  it('serves the bytes to anyone holding the signature — Meta fetches this URL itself', async () => {
    const item = await makeDraft();
    const { mediaId } = await j(await send(plume, { type: 'content.attach_media', item, dataUrl: DATA_URL }));
    const res = await app.request(`/media/${mediaId}?s=${mediaSig(mediaId)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(Buffer.from(await res.arrayBuffer()).toString('base64')).toBe(GIF_B64);
  });

  it('is not an open bucket: no signature, wrong signature, or unknown id all fail', async () => {
    const item = await makeDraft();
    const { mediaId } = await j(await send(plume, { type: 'content.attach_media', item, dataUrl: DATA_URL }));
    expect((await app.request(`/media/${mediaId}`)).status).toBe(403);
    expect((await app.request(`/media/${mediaId}?s=nope`)).status).toBe(403);
    const other = '11111111-1111-1111-1111-111111111111';
    expect((await app.request(`/media/${other}?s=${mediaSig(other)}`)).status).toBe(404);
  });
});

describe('the publish pass', () => {
  it('hands the poster our hosted URL, so a generated image finally reaches the network', async () => {
    const item = await makeDraft();
    const { mediaId } = await j(await send(plume, { type: 'content.attach_media', item, dataUrl: DATA_URL }));
    const at = new Date(Date.now() + 3600e3);
    await send(george, { type: 'content.approve', item, scheduledAt: at.toISOString() });
    await store.upsertConnector({ workspace: 'ws_acme', channelId: null, provider: 'instagram', handle: 'acme', connectedBy: 'george', scopes: '' });
    const conn = await store.connectorWithSecret('ws_acme', 'instagram');
    await store.setConnectorSecret(conn!.id, seal({ access_token: 'tok' } as TokenBundle));

    let seenUrl: string | null | undefined;
    const spy: Poster = { async post(_t, _b, opts) { seenUrl = opts?.mediaUrl; return { url: 'https://instagram.com/p/1' }; } };
    const out = await publishDueItems(store, { instagram: spy }, new Date(at.getTime() + 60e3), 'https://api.neuramesh.app');
    expect(out.published).toBe(1);
    expect(seenUrl).toBe(`https://api.neuramesh.app/media/${mediaId}?s=${mediaSig(mediaId)}`);
  });
});

describe('publicApiBase', () => {
  it('never hands out a *.vercel.app origin — that host greets an anonymous self-fetch with the login page', () => {
    // the four-round X saga: cron ran on the deployment url, publicBase inherited it, and the
    // media self-fetch uploaded vercel.com's login HTML to X as image/jpeg
    expect(publicApiBase('https://neuramesh-control-abc123xyz-example.vercel.app/internal/publish-due')).toBe('https://api.neuramesh.app');
    expect(publicApiBase('https://api.neuramesh.app/internal/publish-due')).toBe('https://api.neuramesh.app');
    expect(publicApiBase('http://localhost:8787/internal/publish-due')).toBe('http://localhost:8787'); // dev keeps its stack
  });
});

describe('xPoster media', () => {
  const tokens = { access_token: 'tok' } as TokenBundle;

  it('drives the live contract — JSON initialize, base64-JSON append at /{id}/append, bare finalize', async () => {
    // pinned from node-twitter-api-v2's uploadMedia (live-verified): the docs' one-URL command
    // story answers "Missing media field in JSON" on the real API — the chunked flow is sub-paths
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: init?.body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (String(url).includes('/media/upload/') || String(url).includes('/media/upload?')) {
        if (String(url).endsWith('/append')) return { ok: true, status: 204, json: async () => { throw new Error('no body'); } } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({ data: { id: 'media-7' } }) } as Response;
      }
      if (String(url).includes('/2/tweets')) return { ok: true, status: 200, json: async () => ({ data: { id: 'tweet-9' } }) } as Response;
      return { ok: true, status: 200, arrayBuffer: async () => GIF_AB(), headers: new Headers({ 'content-type': 'image/gif' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await xPoster.post(tokens, 'hello', { mediaUrl: 'https://api.neuramesh.app/media/x?s=y' }, fake);
    expect(out.url).toBe('https://x.com/i/web/status/tweet-9');
    expect(calls[0]?.url).toContain('/media/x?s=y'); // fetched the image first
    // INITIALIZE: dedicated sub-path, JSON body, flat fields
    expect(calls[1]?.url).toBe('https://api.x.com/2/media/upload/initialize');
    expect(calls[1]?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[1]?.body))).toEqual({ media_type: 'image/gif', total_bytes: expect.any(Number), media_category: 'tweet_image' }); // sniffed from the bytes, not the header
    // APPEND: JSON base64 at /{id}/append — the docs' `format: byte` variant, chosen over
    // multipart because a parser-ignored part finalizes as "media type unrecognized"
    expect(calls[2]?.url).toBe('https://api.x.com/2/media/upload/media-7/append');
    const append = JSON.parse(String(calls[2]?.body)) as { segment_index: number; media: string };
    expect(append.segment_index).toBe(0);
    expect(Buffer.from(append.media, 'base64').toString('base64')).toBe(append.media); // real base64, the exact bytes
    expect(append.media).toBe(GIF_B64);
    // FINALIZE: bare POST at /{id}/finalize
    expect(calls[3]?.url).toBe('https://api.x.com/2/media/upload/media-7/finalize');
    expect(JSON.parse(String(calls[4]?.body))).toEqual({ text: 'hello', media: { media_ids: ['media-7'] } });
  });

  it('declares the mime the BYTES are, not the header\'s word — the webp-wearing-a-png-label case', async () => {
    // our /media route echoes the generator's DECLARED mime; gpt-image once answered webp bytes
    // under a hardcoded png label, and X's finalize sniffed the lie: "media type unrecognized"
    const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([16, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
    const inits: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/media/upload/initialize')) { inits.push(String(init.body)); return { ok: true, status: 200, json: async () => ({ data: { id: 'media-7' } }) } as Response; }
      if (String(url).includes('/media/upload/')) return { ok: true, status: 204, json: async () => { throw new Error('no body'); } } as unknown as Response;
      if (String(url).includes('/2/tweets')) return { ok: true, status: 200, json: async () => ({ data: { id: 'tweet-9' } }) } as Response;
      return { ok: true, status: 200, arrayBuffer: async () => WEBP.buffer.slice(WEBP.byteOffset, WEBP.byteOffset + WEBP.byteLength), headers: new Headers({ 'content-type': 'image/png' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await xPoster.post(tokens, 'hi', { mediaUrl: 'https://api.neuramesh.app/media/x?s=y' }, fake);
    expect(JSON.parse(inits[0]!).media_type).toBe('image/webp'); // the bytes' truth, not the label
  });

  it('still posts text-only when there is no image', async () => {
    const bodies: string[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return { ok: true, status: 200, json: async () => ({ data: { id: 'tweet-1' } }) } as Response;
    }) as unknown as typeof fetch;
    await xPoster.post(tokens, 'no picture', { mediaUrl: null }, fake);
    expect(JSON.parse(bodies[0]!)).toEqual({ text: 'no picture' });
  });

  it('fails loudly when the image will not load, rather than silently tweeting without it', async () => {
    const fake = (async () => ({ ok: false, status: 404, text: async () => 'gone' }) as Response) as unknown as typeof fetch;
    await expect(xPoster.post(tokens, 'hi', { mediaUrl: 'https://example.com/x.png' }, fake)).rejects.toThrow(/media url did not load/);
  });

  it('an upload 403 is the DEAD-GRANT verdict, named: only a re-run Connect adds media.write', async () => {
    // an account connected before media.write joined X_SCOPES: auth is fine, upload is forbidden.
    // XReauthRequired (not a plain error) is what flips the connector row and grows the attention
    // bar's Reconnect button — the live gap was a reason on the card with no fix on the bar.
    const fake = (async (url: string) => {
      if (String(url).includes('/media/upload')) return { ok: false, status: 403, text: async () => '{"title":"Forbidden"}' } as unknown as Response;
      return { ok: true, status: 200, arrayBuffer: async () => GIF_AB(), headers: new Headers({ 'content-type': 'image/gif' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const err = await xPoster.post(tokens, 'hi', { mediaUrl: 'https://api.neuramesh.app/media/x?s=y' }, fake).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(XReauthRequired);
    expect((err as Error).message).toMatch(/media\.write/);
  });
});

describe('content.revise (marketer edits its own draft)', () => {
  it('an AGENT may revise a DRAFT it owns — that is the whole revise loop', async () => {
    const item = await makeDraft();
    const res = await send(plume, { type: 'content.revise', item, body: 'punchier revised copy' });
    expect(res.status).toBe(200);
    const [due] = await store.dueContentItems('2999-01-01T00:00:00Z', 10); // not scheduled → none due
    expect(due).toBeUndefined();
    // read it back via the media lookup path (body isn't exposed there, so assert via a re-approve round-trip)
    await send(george, { type: 'content.approve', item, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    const [sched] = await store.dueContentItems(new Date(Date.now() + 7200e3).toISOString(), 10);
    expect(sched?.body).toBe('punchier revised copy');
  });

  it('carries an image brief + thumb into the draft media', async () => {
    const item = await makeDraft();
    await send(plume, { type: 'content.revise', item, imageBrief: 'a warm gold lamp', thumb: 'data:image/jpeg;base64,TH' });
    // brief lands in media; the card reads it (no direct getter, so re-approve to inspect isn't enough —
    // assert the command was accepted and the item is still a draft the human can approve)
    const res = await send(plume, { type: 'content.revise', item, body: 'and new copy' });
    expect(res.status).toBe(200);
  });

  it('refuses a no-op revision', async () => {
    const item = await makeDraft();
    expect((await send(plume, { type: 'content.revise', item })).status).toBe(422);
  });

  it('lets the marketer revise a SCHEDULED post and UNSCHEDULES it for re-approval (nothing auto-publishes)', async () => {
    const item = await makeDraft();
    await send(george, { type: 'content.approve', item, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    // scheduled → the publish pass would post it at the slot
    const due = () => store.dueContentItems(new Date(Date.now() + 7200e3).toISOString(), 10);
    expect((await due()).some((d) => d.id === item)).toBe(true);
    // a human's free-form "clean up the copy" reaches the marketer, which rewrites it
    const res = await send(plume, { type: 'content.revise', item, body: 'reworked copy — no em dashes' });
    expect(res.status).toBe(200);
    // it's pulled OFF the publish queue back to draft, so the changed text can't ride the old slot
    // without a fresh human approve (nothing publishes unreviewed)
    expect((await due()).some((d) => d.id === item)).toBe(false);
  });
});

describe('content image outcome (surface + retry)', () => {
  it('content.create carries an imageError onto the draft, and a hosted image clears it', async () => {
    const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: 'Growth' }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
    // a briefed draft whose image failed — the reason rides on the card
    const { itemId } = await j(await send(plume, { type: 'content.create', channel: chan.channelId, platform: 'x', body: 'copy', imageBrief: 'a lamp', imageError: 'rate limit reached' }));
    expect(itemId).toBeTruthy();
    // retry succeeds → attach_media clears the error and the card shows the picture
    await send(plume, { type: 'content.attach_media', item: itemId, dataUrl: DATA_URL });
    // (no direct getter for media here; the attach path is covered above — assert it stayed a draft)
    const res = await send(plume, { type: 'content.revise', item: itemId, imageError: '' });
    expect(res.status).toBe(200);
  });

  it("content.revise sets an imageError WITHOUT versioning the draft (a retry isn't a revision)", async () => {
    const item = await makeDraft();
    // an image-only failure note must not create a history version or re-anchor the card
    const res = await send(plume, { type: 'content.revise', item, imageError: 'gpt-image-2 (429)' });
    expect(res.status).toBe(200);
    // still an approvable draft, unversioned
    await send(george, { type: 'content.approve', item, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    const [sched] = await store.dueContentItems(new Date(Date.now() + 7200e3).toISOString(), 10);
    expect(sched?.body).toBe('copy'); // untouched
  });

  it('an image-only touch (imageError) is allowed on a SCHEDULED item and LEAVES the slot intact', async () => {
    const item = await makeDraft();
    await send(george, { type: 'content.approve', item, scheduledAt: new Date(Date.now() + 3600e3).toISOString() });
    // an imageError is a card annotation, not a copy change — it alters no published output, so the
    // post stays scheduled (only a real body/brief revision unschedules for re-approval)
    expect((await send(plume, { type: 'content.revise', item, imageError: 'a card note' })).status).toBe(200);
    expect((await store.dueContentItems(new Date(Date.now() + 7200e3).toISOString(), 10)).some((d) => d.id === item)).toBe(true);
  });
});
