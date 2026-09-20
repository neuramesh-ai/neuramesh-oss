// GET /v1/content/media/:id — a draft's hosted media for the person looking at the card. The public
// /media/:id route is for the networks (HMAC-gated, no session); this one is for the app: the card
// shows the film it made (a video is too big to ride the synced row the way a thumbnail does), so
// the renderer asks with its session and gets the bytes back with their type. Members only.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { actorInWorkspace } from './credits';
import type { Store } from './store';

const STREAM_CHUNK = 1_000_000;

export function contentMediaRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/content/media/:id', async (c) => {
    const media = await store.contentMediaBytes(c.req.param('id'));
    if (!media) return c.json({ error: 'not found' }, 404);
    if (!(await actorInWorkspace(store, c.get('actor'), media.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    // STREAMED, never buffered: a function's buffered response caps at 4.5 MB on the hosted API
    // and a film at the high bitrate passes it (plan §8); a streamed body has no such cap
    const bytes = new Uint8Array(media.bytes);
    const body = new ReadableStream<Uint8Array>({ start(ctl) { for (let at = 0; at < bytes.length; at += STREAM_CHUNK) ctl.enqueue(bytes.subarray(at, at + STREAM_CHUNK)); ctl.close(); } });
    return new Response(body, { headers: { 'content-type': media.mime, 'content-length': String(bytes.length), 'cache-control': 'private, max-age=300' } });
  });
}
