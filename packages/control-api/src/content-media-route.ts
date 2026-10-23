// GET /v1/content/media/:id — a draft's hosted media for the person looking at the card. The public
// /media/:id route is for the networks (HMAC-gated, no session); this one is for the app: the card
// shows the film it made (a video is too big to ride the synced row the way a thumbnail does), so
// the renderer asks with its session and gets the bytes back with their type. Members only.
import type { Actor } from '@neuramesh/shared';
import { CommandSchema } from './commands';
import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { actorInWorkspace, sqlOf } from './credits';
import type { Store } from './store';
import { verifyMediaSig } from './connector-crypto';
import { executeCommand } from './handler';
import { DomainError } from './errors';
import { publicationImage } from './publication-image';

const STREAM_CHUNK = 1_000_000;
const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(ctl) {
  for (let at = 0; at < bytes.length; at += STREAM_CHUNK) ctl.enqueue(bytes.subarray(at, at + STREAM_CHUNK));
  ctl.close();
} });

/** Publishing networks fetch this URL without a session. The per-media HMAC grants access. */
export function publicContentMediaRoute<E extends Env>(app: Hono<E>, store: Store): void {
  app.get('/media/:id', async (c) => {
    const mediaId = c.req.param('id');
    const sig = c.req.query('s') ?? '';
    if (!process.env['NM_CONNECTOR_KEY'] || !verifyMediaSig(mediaId, sig)) return c.text('forbidden', 403);
    const media = await store.contentMediaBytes(mediaId);
    if (!media) return c.text('not found', 404);
    const platform = c.req.query('platform');
    if (platform && !['x', 'instagram', 'linkedin', 'tiktok'].includes(platform)) return c.text('unsupported platform', 400);
    const output = platform ? await publicationImage(media, platform) : media;
    return new Response(stream(new Uint8Array(output.bytes)), {
      headers: { 'content-type': output.mime, 'content-length': String(output.bytes.length), 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
    });
  });
}

export function contentMediaRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  // Dedicated large-body ingress, with exactly the same command authorization as /commands.
  // Full-resolution originals can exceed a serverless control API's buffered request limit.
  app.post('/v1/brain/content-media', bodyLimit({ maxSize: 24 * 1024 * 1024 }) as MiddlewareHandler<E>, async (c: Context<E>) => {
    const parsed = CommandSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || parsed.data.type !== 'content.attach_media') return c.json({ error: 'Supply a content media upload.', code: 'INVALID_INPUT' }, 400);
    const item = await store.contentItemMedia(parsed.data.item);
    if (!item) return c.json({ error: 'Content item not found.', code: 'NOT_FOUND' }, 404);
    const actor = c.get('actor');
    if (!(await actorInWorkspace(store, actor, item.workspace))) return c.json({ error: 'Not your workspace.', code: 'NOT_PERMITTED' }, 403);
    const sql = sqlOf(store);
    if (sql && actor.kind === 'agent') {
      if (!item.channel) return c.json({ error: 'Content channel unavailable.', code: 'NOT_FOUND' }, 404);
      const registration = await sql`select 1 from agent_channels ac join agents a on a.id = ac.agent_id where ac.agent_id = ${actor.id}::uuid and ac.channel_id = ${item.channel}::uuid and a.retired_at is null`;
      if (!registration.length) return c.json({ error: 'Not your channel.', code: 'NOT_PERMITTED' }, 403);
    }
    try { return c.json(await executeCommand(store, c.get('actor'), parsed.data)); }
    catch (error) {
      if (error instanceof DomainError) return c.json({ error: error.message, code: error.code }, error.status as 403);
      throw error;
    }
  });
  app.get('/v1/content/media/:id', async (c) => {
    const sql = sqlOf(store);
    if (sql) {
      const [scope] = await sql`select m.workspace_id, i.channel_id from content_media m join content_items i on i.id = m.content_item_id where m.id = ${c.req.param('id')}::uuid`;
      if (!scope) return c.json({ error: 'not found' }, 404);
      const actor = c.get('actor');
      if (!(await actorInWorkspace(store, actor, scope['workspace_id']))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
      if (actor.kind === 'agent') {
        const registration = await sql`select 1 from agent_channels ac join agents a on a.id = ac.agent_id where ac.agent_id = ${actor.id}::uuid and ac.channel_id = ${scope['channel_id']}::uuid and a.retired_at is null`;
        if (!registration.length) return c.json({ error: 'not your channel', code: 'NOT_PERMITTED' }, 403);
      }
    }
    const media = await store.contentMediaBytes(c.req.param('id'));
    if (!media) return c.json({ error: 'not found' }, 404);
    if (!(await actorInWorkspace(store, c.get('actor'), media.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    // STREAMED, never buffered: a function's buffered response caps at 4.5 MB on the hosted API
    // and a film at the high bitrate passes it (plan §8); a streamed body has no such cap
    const bytes = new Uint8Array(media.bytes);
    const body = stream(bytes);
    return new Response(body, { headers: { 'content-type': media.mime, 'content-length': String(bytes.length), 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
  });
}
