// GET /v1/content/media/:id — a draft's hosted media for the person looking at the card. The public
// /media/:id route is for the networks (HMAC-gated, no session); this one is for the app: the card
// shows the film it made (a video is too big to ride the synced row the way a thumbnail does), so
// the renderer asks with its session and gets the bytes back with their type. Members only.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { actorInWorkspace } from './credits';
import type { Store } from './store';

export function contentMediaRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/content/media/:id', async (c) => {
    const media = await store.contentMediaBytes(c.req.param('id'));
    if (!media) return c.json({ error: 'not found' }, 404);
    if (!(await actorInWorkspace(store, c.get('actor'), media.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    return new Response(new Uint8Array(media.bytes), { headers: { 'content-type': media.mime, 'content-length': String(media.bytes.length), 'cache-control': 'private, max-age=300' } });
  });
}
