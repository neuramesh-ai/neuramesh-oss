// Connectors + the publish pass (marketing-channel plan §4.8): tokens are sealed
// (AES-256-GCM) and never leave the server; due + approved items publish through an
// injectable Poster (the X client in prod, a fake here); one failure never blocks the
// batch and always lands loudly on the row. Disconnect is a human call.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { XReauthRequired, igPoster, liPoster, publishDueItems, ttPoster, type Poster, type TokenBundle, xPoster, xSearchOnConnector, xSearchRecent, xStartUrl } from '../src/connectors';
import { mediaSig, seal, unseal, verifyMediaSig } from '../src/connector-crypto';
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

// a scheduled item whose clock has already struck, seen from `now`
async function makeDueItem(channel: string): Promise<{ itemId: string; now: Date }> {
  const { itemId } = await j(await send(plume, { type: 'content.create', channel, body: 'Subagents forget everything.' }));
  const at = new Date(Date.now() + 3600e3);
  await send(george, { type: 'content.approve', item: itemId, scheduledAt: at.toISOString() });
  return { itemId, now: new Date(at.getTime() + 60e3) };
}

beforeAll(() => { process.env['NM_CONNECTOR_KEY'] = 'test-key-please-ignore'; });
beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('xStartUrl — the grant asked for at connect time', () => {
  it('requests media.write alongside the tweet scopes — image posts 403 at upload without it', () => {
    process.env['X_CLIENT_ID'] = 'client-1';
    const u = new URL(xStartUrl({ workspace: 'ws_acme', channel: null, actor: 'george' }, 'https://api.neuramesh.app/connect/x/callback'));
    const scopes = (u.searchParams.get('scope') ?? '').split(' ');
    for (const s of ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write']) expect(scopes).toContain(s);
  });
});

describe('seal / unseal — tokens never travel in the clear', () => {
  it('round-trips and rejects tampering', () => {
    const secret = { access_token: 'a1', refresh_token: 'r1' };
    const sealed = seal(secret);
    // Ciphertext is base64url; a short plaintext substring can occur by chance in
    // that alphabet. Compare decoded bytes with the complete serialized secret.
    expect(Buffer.from(sealed, 'base64url')).not.toEqual(Buffer.from(JSON.stringify(secret)));
    expect(unseal<TokenBundle>(sealed).access_token).toBe('a1');
    expect(() => unseal(sealed.slice(0, -4) + 'AAAA')).toThrow();
  });
});

describe('publishDueItems — due + approved → post → receipt', () => {
  it('publishes through the poster with unsealed tokens; the due list drains', async () => {
    const channel = await makeRoom();
    const { now } = await makeDueItem(channel);
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@_neuramesh', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 'live-token' }));
    const seen: string[] = [];
    const poster: Poster = { async post(tokens, body) { seen.push(`${tokens.access_token}:${body}`); return { url: 'https://x.com/i/web/status/1' }; } };
    const out = await publishDueItems(store, { x: poster }, now);
    expect(out).toEqual({ published: 1, failed: 0, held: 0 });
    expect(seen).toEqual(['live-token:Subagents forget everything.']);
    expect(await store.dueContentItems(now.toISOString(), 10)).toEqual([]);
  });

  it('HOLDS a post that was meant to have an image until the picture is attached (never text-only)', async () => {
    const channel = await makeRoom();
    // an image was intended (a brief), but the post got scheduled before the picture was attached —
    // the 2026-07-24 case where the slot fired first and the post went out on X without its image
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'launch copy', imageBrief: 'a warm on-brand hero' }));
    const at = new Date(Date.now() + 3600e3);
    await send(george, { type: 'content.approve', item: itemId, scheduledAt: at.toISOString() });
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@_neuramesh', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 'live-token' }));
    const now = new Date(at.getTime() + 60e3);
    let posted = 0;
    const poster: Poster = { async post() { posted += 1; return { url: 'https://x.com/i/web/status/1' }; } };

    // due, but no image on it yet → HELD (not posted), and it STAYS scheduled for the next pass
    expect(await publishDueItems(store, { x: poster }, now)).toEqual({ published: 0, failed: 0, held: 1 });
    expect(posted).toBe(0);
    expect((await store.dueContentItems(now.toISOString(), 10)).some((d) => d.id === itemId)).toBe(true);

    // once the image lands, the very next pass sends it complete — with its picture
    const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    await send(plume, { type: 'content.attach_media', item: itemId, dataUrl: GIF });
    expect(await publishDueItems(store, { x: poster }, now, 'https://api.neuramesh.app')).toEqual({ published: 1, failed: 0, held: 0 });
    expect(posted).toBe(1);
  });

  it('a film is the post\'s media on X, holds while the film is in flight, and fails on another network with the way out', async () => {
    const channel = await makeRoom();
    const MP4 = `data:video/mp4;base64,${Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(24)]).toString('base64')}`;
    const stamp = (ws: string) => createEvent({ type: 'content.updated', source: formatAddress(plume), target: 'resource/content/x', workspace: ws, payload: {} });
    const schedule = async (itemId: string): Promise<Date> => { const at = new Date(Date.now() + 3600e3); await send(george, { type: 'content.approve', item: itemId, scheduledAt: at.toISOString() }); return new Date(at.getTime() + 60e3); };
    for (const provider of ['x', 'linkedin']) { const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider, handle: '@_neuramesh', connectedBy: 'george', scopes: '' }); await store.setConnectorSecret(id, seal({ access_token: 'live-token' })); }
    const seen: Array<{ platform: string; mediaUrl: string | null | undefined }> = [];
    const poster = (platform: string): Poster => ({ async post(_t, _b, opts) { seen.push({ platform, mediaUrl: opts?.mediaUrl }); return { url: `https://${platform}/1` }; } });
    const posters = { x: poster('x'), linkedin: poster('linkedin') };

    // a video post on X: the caption, the script, the shot direction as its brief (never a picture)
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'caption', script: '[0:00-0:03] hook\n[0:03-0:08] the app', imageBrief: 'Vertical 9:16, direct to camera' }));
    const now = await schedule(itemId);
    // the film is in flight → HELD, never sent as text (the brief is not an image intent here)
    await store.reviseDraft(itemId, { body: null, imageBrief: null, thumb: null, videoPending: true }, stamp);
    expect(await publishDueItems(store, posters, now, 'https://api.neuramesh.app')).toEqual({ published: 0, failed: 0, held: 1 });
    // the film lands → it is the media the poster gets, through the signed hosted url
    await store.reviseDraft(itemId, { body: null, imageBrief: null, thumb: null, videoPending: false }, stamp);
    const { mediaId } = await j(await send(plume, { type: 'content.attach_media', item: itemId, dataUrl: MP4 }));
    expect(await publishDueItems(store, posters, now, 'https://api.neuramesh.app')).toEqual({ published: 1, failed: 0, held: 0 });
    expect(seen).toEqual([{ platform: 'x', mediaUrl: expect.stringContaining(`/media/${mediaId}?s=`) }]);

    // the same film on LinkedIn: a loud failure that names the way out, never a text post
    const { itemId: li } = await j(await send(plume, { type: 'content.create', channel, platform: 'linkedin', body: 'caption', script: '[0:00-0:03] hook\n[0:03-0:08] the app' }));
    await send(plume, { type: 'content.attach_media', item: li, dataUrl: MP4 });
    const now2 = await schedule(li);
    expect(await publishDueItems(store, posters, now2, 'https://api.neuramesh.app')).toEqual({ published: 0, failed: 1, held: 0 });
    expect(seen.length).toBe(1);
    const row = (store as unknown as { contentItems: Array<{ id: string; status: string; lastError?: string | null }> }).contentItems.find((x) => x.id === li);
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toMatch(/cannot post a video to linkedin yet.*Download the film/);

    // a video post with no film and none in flight posts its caption: the preview said so before the approve
    const { itemId: bare } = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'caption only', script: '[0:00-0:03] hook\n[0:03-0:08] the app', imageBrief: 'Vertical 9:16' }));
    const now3 = await schedule(bare);
    expect(await publishDueItems(store, posters, now3, 'https://api.neuramesh.app')).toEqual({ published: 1, failed: 0, held: 0 });
    expect(seen[1]).toEqual({ platform: 'x', mediaUrl: null });
  });

  it('no connected account → the item fails loudly, the batch continues', async () => {
    const channel = await makeRoom();
    const { now } = await makeDueItem(channel);
    const out = await publishDueItems(store, { x: { async post() { throw new Error('unreachable'); } } }, now);
    expect(out).toEqual({ published: 0, failed: 1, held: 0 });
  });

  it('a poster refresh rotates the sealed secret (secretPatch persists)', async () => {
    const channel = await makeRoom();
    const { now } = await makeDueItem(channel);
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@_neuramesh', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 'old', refresh_token: 'r1' }));
    const poster: Poster = { async post() { return { url: 'https://x.com/i/web/status/2', secretPatch: { access_token: 'new', refresh_token: 'r2' } }; } };
    await publishDueItems(store, { x: poster }, now);
    const conn = await store.connectorWithSecret('ws_acme', 'x');
    expect(unseal<TokenBundle>(conn!.ciphertext!).access_token).toBe('new');
  });
});

describe('connector.disconnect — a human call', () => {
  it('agents are refused; revoke deletes the sealed secret', async () => {
    const channel = await makeRoom();
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@_neuramesh', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 't' }));
    expect((await send(plume, { type: 'connector.disconnect', connector: id })).status).toBe(403);
    expect((await send(george, { type: 'connector.disconnect', connector: id })).status).toBe(200);
    const conn = await store.connectorWithSecret('ws_acme', 'x');
    expect(conn!.status).toBe('revoked');
    expect(conn!.ciphertext).toBeNull();
  });
});

describe('liPoster — versioned Posts API, text-first', () => {
  it('posts with the member urn + version headers; the feed url comes from x-restli-id', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return { ok: true, status: 201, headers: new Headers({ 'x-restli-id': 'urn:li:share:987' }), text: async () => '', json: async () => ({}) };
    }) as unknown as typeof fetch;
    const out = await liPoster.post({ access_token: 'liTok', meta: { person: 'AbC123' } }, 'hello operators', undefined, fetchFn);
    expect(out.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:987');
    const req = captured!;
    expect(req.url).toBe('https://api.linkedin.com/rest/posts');
    const h = req.init.headers as Record<string, string>;
    expect(h['LinkedIn-Version']).toBeTruthy();
    expect(h['X-Restli-Protocol-Version']).toBe('2.0.0');
    const body = JSON.parse(String(req.init.body));
    expect(body.author).toBe('urn:li:person:AbC123');
    expect(body.commentary).toBe('hello operators');
    expect(body.lifecycleState).toBe('PUBLISHED');
  });

  it('an expired token fails loudly with the reconnect instruction (no partner refresh pretend)', async () => {
    await expect(liPoster.post({ access_token: 't', expires_at: Date.now() - 1000, meta: { person: 'p' } }, 'x', undefined, (async () => { throw new Error('should not fetch'); }) as unknown as typeof fetch))
      .rejects.toThrow(/reconnect LinkedIn/);
  });
});

describe('igPoster — container → publish → permalink; media is REQUIRED', () => {
  it('refuses a draft without media, naming the fix', async () => {
    await expect(igPoster.post({ access_token: 't', meta: { ig_user: '178' } }, 'caption', { mediaUrl: null }))
      .rejects.toThrow(/needs an image/);
  });

  it('walks the two-step publish and returns the permalink', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/media_publish')) return { ok: true, json: async () => ({ id: 'media9' }), text: async () => '' };
      if (String(url).includes('/media?') || String(url).endsWith('/media')) return { ok: true, json: async () => ({ id: 'cont1' }), text: async () => '' };
      return { ok: true, json: async () => ({ permalink: 'https://www.instagram.com/p/xyz/' }), text: async () => '' };
    }) as unknown as typeof fetch;
    const out = await igPoster.post({ access_token: 't', meta: { ig_user: '178' } }, 'caption', { mediaUrl: 'https://cdn.example/img.png' }, fetchFn);
    expect(out.url).toBe('https://www.instagram.com/p/xyz/');
    expect(calls[0]).toContain('/178/media');
    expect(calls[1]).toContain('/178/media_publish');
  });
});

describe('publish routing — per-platform posters, honest gaps', () => {
  it('routes by platform and fails unwired platforms with a reason', async () => {
    const channel = await makeRoom();
    const { itemId: xId } = await j(await send(plume, { type: 'content.create', channel, platform: 'x', body: 'to x' }));
    const { itemId: emId } = await j(await send(plume, { type: 'content.create', channel, platform: 'email', body: 'to email' }));
    const at = new Date(Date.now() + 3600e3);
    await send(george, { type: 'content.approve', item: xId, scheduledAt: at.toISOString() });
    await send(george, { type: 'content.approve', item: emId, scheduledAt: at.toISOString() });
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@n', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 't' }));
    const posted: string[] = [];
    const out = await publishDueItems(store, { x: { async post(_t, body) { posted.push(body); return { url: 'https://x.com/1' }; } } }, new Date(at.getTime() + 60e3));
    expect(out.published).toBe(1);
    expect(out.failed).toBe(1);
    expect(posted).toEqual(['to x']);
  });

  it('the publish pass hands posters the item id + public base (the tiktok proxy inputs)', async () => {
    const channel = await makeRoom();
    const { itemId } = await j(await send(plume, { type: 'content.create', channel, platform: 'tiktok', body: 'to tiktok', mediaUrl: 'https://cdn.example/pic.png' }));
    const at = new Date(Date.now() + 3600e3);
    await send(george, { type: 'content.approve', item: itemId, scheduledAt: at.toISOString() });
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'tiktok', handle: '@n', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal({ access_token: 't' }));
    let got: { itemId?: string; publicBase?: string | null; mediaUrl?: string | null } = {};
    const poster: Poster = { async post(_t, _b, opts) { got = opts ?? {}; return { url: 'https://www.tiktok.com/' }; } };
    await publishDueItems(store, { tiktok: poster }, new Date(at.getTime() + 60e3), 'https://api.example');
    expect(got.itemId).toBe(itemId);
    expect(got.publicBase).toBe('https://api.example');
    expect(got.mediaUrl).toBe('https://cdn.example/pic.png');
  });
});

describe('ttPoster — inbox photo draft; 24h tokens refresh in-line', () => {
  const bundle: TokenBundle = { access_token: 'old', refresh_token: 'r1', expires_at: Date.now() - 1000, meta: { open_id: 'o1' } };
  const opts = { mediaUrl: 'https://cdn.example/pic.png', itemId: 'item-1', publicBase: 'https://api.example' };

  it('refuses a draft without media, naming the fix', async () => {
    await expect(ttPoster.post(bundle, 'body', { ...opts, mediaUrl: null }))
      .rejects.toThrow(/needs an image/);
  });

  it('refreshes the stale token, posts MEDIA_UPLOAD photo with the signed proxy url, and patches the secret', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/oauth/token/')) return { ok: true, status: 200, json: async () => ({ access_token: 'new', refresh_token: 'r2', expires_in: 86400 }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ data: { publish_id: 'p1' }, error: { code: 'ok' } }), text: async () => '' };
    }) as unknown as typeof fetch;
    const out = await ttPoster.post(bundle, 'first line\nrest of the caption', opts, fetchFn);
    expect(out.url).toContain('tiktokstudio');
    expect(out.secretPatch?.access_token).toBe('new');
    expect(out.secretPatch?.refresh_token).toBe('r2');
    expect(out.secretPatch?.meta?.['open_id']).toBe('o1'); // meta must survive rotation
    const init = calls.find((c) => c.url.includes('/post/publish/content/init/'))!;
    const body = JSON.parse(String(init.init?.body));
    expect(body.post_mode).toBe('MEDIA_UPLOAD');
    expect(body.media_type).toBe('PHOTO');
    expect(body.source_info.source).toBe('PULL_FROM_URL');
    expect(body.source_info.photo_images[0]).toBe(`https://api.example/connect/tiktok/media/item-1?s=${mediaSig('item-1')}`);
    expect(body.post_info.title).toBe('first line');
  });

  it('maps the domain-verification refusal to the one-time-setup instruction', async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes('/oauth/token/')) return { ok: true, json: async () => ({ access_token: 'new', refresh_token: 'r2', expires_in: 86400 }), text: async () => '' };
      return { ok: false, status: 400, json: async () => ({ error: { code: 'url_ownership_unverified', message: 'nope' } }), text: async () => '' };
    }) as unknown as typeof fetch;
    await expect(ttPoster.post(bundle, 'x', opts, fetchFn)).rejects.toThrow(/verify the api domain/);
  });
});

describe('the tiktok media proxy — sig-gated, never an open proxy', () => {
  it('round-trips its sig and rejects tampering', () => {
    expect(verifyMediaSig('item-9', mediaSig('item-9'))).toBe(true);
    expect(verifyMediaSig('item-9', mediaSig('item-8'))).toBe(false);
    expect(verifyMediaSig('item-9', '')).toBe(false);
  });

  it('403s a bad sig; 404s a non-tiktok item; 400s a private-host media url before any fetch', async () => {
    const channel = await makeRoom();
    const { itemId: igId } = await j(await send(plume, { type: 'content.create', channel, platform: 'instagram', body: 'ig', mediaUrl: 'https://cdn.example/a.png' }));
    const { itemId: ttId } = await j(await send(plume, { type: 'content.create', channel, platform: 'tiktok', body: 'tt', mediaUrl: 'http://127.0.0.1:8791/internal.png' }));
    expect((await app.request(`/connect/tiktok/media/${ttId}?s=wrong`)).status).toBe(403);
    expect((await app.request(`/connect/tiktok/media/${igId}?s=${mediaSig(igId)}`)).status).toBe(404);
    expect((await app.request(`/connect/tiktok/media/${ttId}?s=${mediaSig(ttId)}`)).status).toBe(400);
  });
});

// George, 2026-08-02: a brand-new project's marketing setup showed ANOTHER project's X account as
// already connected — and the table's `unique (workspace_id, provider)` meant connecting there
// would have overwritten the first product's account rather than added a second. 0106 moves the
// key to the project. The publish pass is the sharp end: posting one product's content from
// another's handle is externally visible and unrecallable.
describe('connectors belong to a PROJECT, not a workspace (0106)', () => {
  async function roomIn(projectName: string): Promise<{ channel: string; project: string }> {
    const proj = await j(await send(george, { type: 'project.create', workspace: 'ws_acme', name: projectName }));
    const chan = await j(await send(george, { type: 'channel.create', workspace: 'ws_acme', project: proj.projectId, slug: 'marketing' }));
    return { channel: chan.channelId as string, project: proj.projectId as string };
  }

  it('a second project connecting the same provider ADDS an account — it does not overwrite the first', async () => {
    const a = await roomIn('Flowe');
    const b = await roomIn('Neuramesh');
    const one = await store.upsertConnector({ workspace: 'ws_acme', channelId: a.channel, provider: 'x', handle: 'joinflowe', connectedBy: 'george', scopes: '' });
    const two = await store.upsertConnector({ workspace: 'ws_acme', channelId: b.channel, provider: 'x', handle: 'neuramesh', connectedBy: 'george', scopes: '' });
    expect(two.id).not.toBe(one.id); // the bug: these used to be the same row

    // …and each project still resolves to ITS OWN handle
    await store.setConnectorSecret(one.id, seal({ access_token: 'a' }));
    await store.setConnectorSecret(two.id, seal({ access_token: 'b' }));
    expect((await store.connectorWithSecret('ws_acme', 'x', a.channel))?.id).toBe(one.id);
    expect((await store.connectorWithSecret('ws_acme', 'x', b.channel))?.id).toBe(two.id);
  });

  it('re-connecting from the SAME project still updates in place rather than duplicating', async () => {
    const a = await roomIn('Flowe');
    const first = await store.upsertConnector({ workspace: 'ws_acme', channelId: a.channel, provider: 'x', handle: 'old', connectedBy: 'george', scopes: '' });
    const again = await store.upsertConnector({ workspace: 'ws_acme', channelId: a.channel, provider: 'x', handle: 'new', connectedBy: 'george', scopes: '' });
    expect(again.id).toBe(first.id);
  });

  it('the publish pass posts with the item’s OWN project account, never the other product’s', async () => {
    const a = await roomIn('Flowe');
    const b = await roomIn('Neuramesh');
    const flowe = await store.upsertConnector({ workspace: 'ws_acme', channelId: a.channel, provider: 'x', handle: 'joinflowe', connectedBy: 'george', scopes: '' });
    const mesh = await store.upsertConnector({ workspace: 'ws_acme', channelId: b.channel, provider: 'x', handle: 'neuramesh', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(flowe.id, seal({ access_token: 'flowe-token' }));
    await store.setConnectorSecret(mesh.id, seal({ access_token: 'mesh-token' }));

    // an item scheduled in NEURAMESH's room
    const { itemId, now } = await makeDueItem(b.channel);
    expect(itemId).toBeTruthy();

    const used: string[] = [];
    const poster: Poster = { async post(tokens) { used.push(tokens.access_token as string); return { url: 'https://x.com/p/1' }; } };
    const out = await publishDueItems(store, { x: poster }, now);
    expect(out.published).toBe(1);
    expect(used).toEqual(['mesh-token']); // NOT flowe's
  });
});

// ── Reading X on the connector that publishes (2026-08-09) ───────────────────────────────
// The first cut asked each user for their own app's Bearer Token, which is fine for a
// developer and impossible for a customer. The Connect button's token already carries
// `tweet.read` (X_SCOPES), and X's recent-search accepts OAuth 2.0 user context — so reads
// ride the connection the user already made, server-side.
describe('xSearchRecent — real numbers or an honest failure', () => {
  const tok = { access_token: 'at1' };

  it('maps hits with author handles and REAL engagement, and builds the post URL', async () => {
    let seen = '';
    const fetchFn = (async (url: string) => {
      seen = String(url);
      return {
        ok: true, status: 200,
        json: async () => ({
          data: [{ id: '9', text: 'agents are eating orchestration', created_at: '2026-08-08T10:00:00Z', author_id: 'u1',
                   public_metrics: { like_count: 12, retweet_count: 3, reply_count: 4, quote_count: 1, impression_count: 900 } }],
          includes: { users: [{ id: 'u1', username: 'devperson', name: 'Dev Person' }] },
        }),
      };
    }) as unknown as typeof fetch;
    const out = await xSearchRecent(tok, '"ai agents" -is:retweet', 10, fetchFn);
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]!.authorHandle).toBe('@devperson');
    expect(out.hits[0]!.metrics).toEqual({ replies: 4, reposts: 3, likes: 12, quotes: 1, impressions: 900 });
    expect(out.hits[0]!.url).toBe('https://x.com/devperson/status/9');
    // the query and the fields that MAKE the numbers real must be on the wire
    expect(seen).toContain('search/recent');
    expect(seen).toContain('public_metrics');
    expect(seen).toContain('expansions=author_id');
  });

  it('metrics are NULL when X omits them — never zero-filled, so nothing can be passed off as measured', async () => {
    const fetchFn = (async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: '1', text: 'hi' }] }) })) as unknown as typeof fetch;
    const out = await xSearchRecent(tok, 'q', 10, fetchFn);
    expect(out.hits[0]!.metrics).toBeNull();
    expect(out.hits[0]!.authorHandle).toBeNull();
  });

  it('max_results is floored at X’s minimum of 10 and capped at 100', async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: string) => { seen.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
    await xSearchRecent(tok, 'q', 1, fetchFn);
    await xSearchRecent(tok, 'q', 5000, fetchFn);
    expect(seen[0]).toContain('max_results=10');
    expect(seen[1]).toContain('max_results=100');
  });

  it('a 401 refreshes ONCE and re-tries, returning the rotated bundle for the caller to persist', async () => {
    process.env['X_CLIENT_ID'] = 'cid';
    process.env['X_CLIENT_SECRET'] = 'sec';
    let n = 0;
    const fetchFn = (async (url: string) => {
      const u = String(url);
      if (u.includes('oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 }) };
      n += 1;
      if (n === 1) return { ok: false, status: 401, text: async () => 'expired' };
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }) as unknown as typeof fetch;
    const out = await xSearchRecent({ access_token: 'old', refresh_token: 'rt1' }, 'q', 10, fetchFn);
    expect(n).toBe(2); // retried exactly once
    expect(out.secretPatch?.access_token).toBe('at2');
  });

  it('403 and 429 say what the human can actually do about it', async () => {
    const mk = (status: number) => (async () => ({ ok: false, status, text: async () => '' })) as unknown as typeof fetch;
    await expect(xSearchRecent(tok, 'q', 10, mk(403))).rejects.toThrow(/API access may not include search/);
    await expect(xSearchRecent(tok, 'q', 10, mk(429))).rejects.toThrow(/rate-limited/);
  });
});

// ── The @joinflowe incident (2026-08-17): "x token refresh failed 400", forever ──────────────
// X's refresh tokens are SINGLE-USE. The old code persisted a rotation only when the whole call
// succeeded, so a refresh followed by one rate-limited search stranded the store with a spent
// refresh token — every later refresh 400d, retrying could never help, and nothing ever told a
// human to reconnect. These tests pin the three repairs: rotation lands the moment it happens,
// a dead grant flips the connector ONCE and says RECONNECT_REQUIRED, and a racing sweep picks
// up the winner's rotation instead of condemning the connection.
describe('x token rotation is durable; a dead grant says RECONNECT, once', () => {
  beforeAll(() => { process.env['X_CLIENT_ID'] = 'cid'; process.env['X_CLIENT_SECRET'] = 'sec'; });

  // long-expired access token → every call must refresh before it can search
  const expired: TokenBundle = { access_token: 'spent-at', refresh_token: 'rt1', expires_at: 1 };
  const DEAD_GRANT = '{"error":"invalid_request","error_description":"Value passed for the token was invalid."}';

  async function connectedX(channel: string): Promise<string> {
    const { id } = await store.upsertConnector({ workspace: 'ws_acme', channelId: channel, provider: 'x', handle: '@joinflowe', connectedBy: 'george', scopes: '' });
    await store.setConnectorSecret(id, seal(expired));
    return id;
  }

  it('a refresh followed by a FAILED search still persists the rotated bundle — one 429 no longer bricks the account', async () => {
    const channel = await makeRoom();
    await connectedX(channel);
    const fetchFn = (async (url: string) => {
      if (String(url).includes('oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 }), text: async () => '' };
      return { ok: false, status: 429, text: async () => '' };
    }) as unknown as typeof fetch;
    const out = await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, fetchFn);
    expect(out).toMatchObject({ ok: false, code: 'X_ERROR' }); // a rate limit stays transient, never a reconnect verdict
    const conn = await store.connectorWithSecret('ws_acme', 'x', channel);
    expect(conn!.status).toBe('connected');
    expect(unseal<TokenBundle>(conn!.ciphertext!).refresh_token).toBe('rt2'); // the rotation reached the store anyway
  });

  it('X 400 on refresh = dead grant: the connector flips (secret kept) and the caller hears RECONNECT_REQUIRED — later calls never hit X again', async () => {
    const channel = await makeRoom();
    await connectedX(channel);
    let tokenCalls = 0;
    const fetchFn = (async (url: string) => {
      if (String(url).includes('oauth2/token')) { tokenCalls += 1; return { ok: false, status: 400, text: async () => DEAD_GRANT }; }
      throw new Error('the search endpoint must never be called on a dead grant');
    }) as unknown as typeof fetch;
    const first = await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, fetchFn);
    expect(first).toMatchObject({ ok: false, code: 'RECONNECT_REQUIRED' });
    if (!first.ok) expect(first.error).toContain('@joinflowe');
    const conn = await store.connectorWithSecret('ws_acme', 'x', channel);
    // the server's OWN verdict — distinct from the 'revoked' a human disconnect writes (0121),
    // so a synced client can offer Reconnect loudly without nagging about deliberate offs
    expect(conn!.status).toBe('reauth_required');
    expect(conn!.ciphertext).not.toBeNull(); // the server's own verdict never destroys the sealed secret
    expect(tokenCalls).toBe(1);
    // the second call answers from the row — no more hammering X's token endpoint
    expect(await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, fetchFn)).toMatchObject({ ok: false, code: 'RECONNECT_REQUIRED' });
    expect(tokenCalls).toBe(1);
  });

  it('a transient refresh failure (X 500) is loud but NEVER a reconnect verdict', async () => {
    const channel = await makeRoom();
    await connectedX(channel);
    const fetchFn = (async (url: string) => {
      if (String(url).includes('oauth2/token')) return { ok: false, status: 500, text: async () => 'x is having a day' };
      throw new Error('unreachable');
    }) as unknown as typeof fetch;
    const out = await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, fetchFn);
    expect(out).toMatchObject({ ok: false, code: 'X_ERROR' });
    expect((await store.connectorWithSecret('ws_acme', 'x', channel))!.status).toBe('connected');
  });

  it('two sweeps racing one single-use token: the loser picks up the winner’s rotation instead of condemning the connection', async () => {
    const channel = await makeRoom();
    const id = await connectedX(channel);
    const winner: TokenBundle = { access_token: 'at-win', refresh_token: 'rt-win', expires_at: Date.now() + 7200e3 };
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('oauth2/token')) {
        // the winner spent rt1 and landed its rotation while our request was in flight
        await store.setConnectorSecret(id, seal(winner));
        return { ok: false, status: 400, text: async () => DEAD_GRANT };
      }
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer at-win');
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }) as unknown as typeof fetch;
    const out = await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, fetchFn);
    expect(out).toMatchObject({ ok: true });
    expect((await store.connectorWithSecret('ws_acme', 'x', channel))!.status).toBe('connected');
  });

  it('a human disconnect stays NOT_CONNECTED — RECONNECT_REQUIRED is only the server’s own dead-grant verdict', async () => {
    const channel = await makeRoom();
    const id = await connectedX(channel);
    await send(george, { type: 'connector.disconnect', connector: id });
    const out = await xSearchOnConnector(store, 'ws_acme', channel, 'q', 10, (async () => { throw new Error('no fetch'); }) as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: false, code: 'NOT_CONNECTED' });
  });

  it('xPoster lands the rotation through opts.persistPatch the moment refresh succeeds — a failed tweet can no longer strand a spent token', async () => {
    const persisted: TokenBundle[] = [];
    const fetchFn = (async (url: string) => {
      if (String(url).includes('oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 7200 }), text: async () => '' };
      return { ok: false, status: 500, text: async () => 'x is down' };
    }) as unknown as typeof fetch;
    await expect(xPoster.post(expired, 'hello', { persistPatch: async (b) => { persisted.push(b); } }, fetchFn)).rejects.toThrow(/x post failed 500/);
    expect(persisted.map((b) => b.refresh_token)).toEqual(['rt2']);
  });

  it('the publish pass: a dead grant flips the connector and fails the item with the reconnect instruction', async () => {
    const channel = await makeRoom();
    const { now } = await makeDueItem(channel);
    await connectedX(channel);
    const failures: string[] = [];
    const orig = store.markContentFailed.bind(store);
    store.markContentFailed = async (itemId: string, err: string) => { failures.push(err); await orig(itemId, err); };
    const poster: Poster = { async post() { throw new XReauthRequired('x refused to renew the stored authorization'); } };
    expect(await publishDueItems(store, { x: poster }, now)).toEqual({ published: 0, failed: 1, held: 0 });
    expect((await store.connectorWithSecret('ws_acme', 'x', channel))!.status).toBe('reauth_required');
    expect(failures[0]).toContain('reconnect');
    expect(failures[0]).toContain('@joinflowe');
    // the CAUSE rides the verdict: "needs re-authorizing" without the why (spent token vs
    // missing media.write grant) told the human what to do but not what happened
    expect(failures[0]).toContain('x refused to renew the stored authorization');
  });

  it('the /v1/x/search route answers a flipped connector with 409 RECONNECT_REQUIRED', async () => {
    const channel = await makeRoom();
    const id = await connectedX(channel);
    await store.markConnectorReauth(id);
    const res = await app.request(`/v1/x/search?workspace=ws_acme&channel=${channel}&q=hello`, { headers: { 'x-nm-actor': JSON.stringify(plume) } });
    expect(res.status).toBe(409);
    const body = await j(res);
    expect(body.code).toBe('RECONNECT_REQUIRED');
    expect(body.error).toMatch(/reconnect/i);
  });
});
