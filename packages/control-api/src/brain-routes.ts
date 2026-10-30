import type { Actor } from '@neuramesh/shared';
import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';
import { z } from 'zod';
import { sqlOf } from './credits';
import type { Store } from './store';
import { configuredBrainObjects, type BrainObjectStore } from './brain-objects';
import { BrainError, BrainStore } from './brain-store';
import { decodedBrainSnapshot } from './brain-decoded';
import type { BrainThreadSnapshot } from '@neuramesh/shared';
import { hashMachineToken } from './machine-auth';

const CommitSchema = z.object({
  workspace: z.string().uuid(), commitId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  deviceId: z.string().min(1).max(256),
  events: z.array(z.object({ id: z.string().min(1).max(256), type: z.string().min(1).max(128), timestamp: z.string().datetime({ offset: true }) }).passthrough()).max(4096),
  runtimeMessages: z.array(z.unknown()).optional(), metadata: z.record(z.unknown()).optional(), artifactIds: z.array(z.string().uuid()).max(256).optional(),
}).strict();
const ArtifactSchema = z.object({
  workspace: z.string().uuid(), threadId: z.string().uuid(), id: z.string().uuid(),
  name: z.string().min(1).max(512), mime: z.string().max(255).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  contentBase64: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), messageId: z.string().uuid().optional(),
  kind: z.enum(['screenshot', 'file', 'doc', 'diff', 'test_report', 'design', 'ship']).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(), channel: z.string().uuid().optional(),
}).strict();
const ScopeSchema = z.object({ workspace: z.string().uuid(), id: z.string().uuid() });

async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new BrainError('TOO_LARGE', 'This brain upload exceeds the request limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BrainError('INVALID_INPUT', 'Supply a JSON request body.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new BrainError('TOO_LARGE', 'This brain upload exceeds the request limit.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new BrainError('INVALID_INPUT', 'Supply a valid JSON request body.', 400); }
}

export function brainRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, options: { objects?: BrainObjectStore } = {}): void {
  let objects = options.objects;
  const service = (): BrainStore => {
    const sql = sqlOf(store);
    objects ??= configuredBrainObjects() ?? undefined;
    if (!sql || !objects) throw new BrainError('BRAIN_UNAVAILABLE', 'Configure brain object storage on the server, then retry.', 503);
    return new BrainStore(sql, objects);
  };
  const machineScope = async (authorization: string | undefined, workspace: string): Promise<void> => {
    const token = /^Bearer\s+(nmm_.+)$/i.exec(authorization ?? '')?.[1];
    if (!token) return;
    const machine = await store.machineByTokenHash?.(hashMachineToken(token));
    if (!machine || machine.workspace_id !== workspace) throw new BrainError('NOT_FOUND', 'This machine has no access to that workspace.', 404);
  };
  app.post('/v1/brain/threads/:id/commits', async (c) => {
    const parsed = CommitSchema.safeParse(await boundedJson(c.req.raw, 16 * 1024 * 1024));
    if (!parsed.success || !z.string().uuid().safeParse(c.req.param('id')).success) return c.json({ error: 'Supply a valid brain commit.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), parsed.data.workspace);
    return c.json(await service().commit(c.get('actor'), c.req.param('id'), parsed.data));
  });
  app.get('/v1/brain/threads/:id', compress() as MiddlewareHandler<E>, async (c: Context<E, '/v1/brain/threads/:id'>) => {
    const scope = ScopeSchema.safeParse({ workspace: c.req.query('workspace'), id: c.req.param('id') });
    if (!scope.success) return c.json({ error: 'Supply a valid workspace and thread ID.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), scope.data.workspace);
    c.header('cache-control', 'no-store');
    c.header('vary', 'Accept-Encoding');
    const format = c.req.query('format');
    // `since`: the revision the reader holds. The head at that revision reads as unchanged, and anything else reads in full
    const held = c.req.query('since');
    const since = held !== undefined && /^\d{1,12}$/.test(held) ? Number(held) : undefined;
    const snapshot = await service().read(c.get('actor'), scope.data.workspace, scope.data.id, format === 'activity' ? 'activity' : format === 'compact' || format === 'compact-decoded', since);
    if ('unchanged' in snapshot && snapshot.unchanged) return c.json(snapshot);
    return c.json(format === 'decoded' || format === 'compact-decoded'
      ? decodedBrainSnapshot(snapshot as BrainThreadSnapshot, format === 'compact-decoded' ? 64 * 1024 * 1024 : undefined) : snapshot);
  });
  app.post('/v1/brain/artifacts', async (c) => {
    const parsed = ArtifactSchema.safeParse(await boundedJson(c.req.raw, 24 * 1024 * 1024));
    if (!parsed.success) return c.json({ error: 'Supply a valid artifact.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), parsed.data.workspace);
    return c.json(await service().artifact(c.get('actor'), parsed.data));
  });
  app.get('/v1/brain/threads/:id/artifacts', async (c) => {
    const scope = ScopeSchema.safeParse({ workspace: c.req.query('workspace'), id: c.req.param('id') });
    if (!scope.success) return c.json({ error: 'Supply a valid workspace and thread ID.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), scope.data.workspace);
    c.header('cache-control', 'no-store');
    return c.json({ artifacts: await service().artifacts(c.get('actor'), scope.data.workspace, scope.data.id) });
  });
  app.get('/v1/brain/artifacts/:id', async (c) => {
    const scope = ScopeSchema.safeParse({ workspace: c.req.query('workspace'), id: c.req.param('id') });
    if (!scope.success) return c.json({ error: 'Supply a valid workspace and artifact ID.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), scope.data.workspace);
    const result = await service().download(c.get('actor'), scope.data.workspace, scope.data.id);
    // Arbitrary HTML/SVG remains a download, never executable application-origin content.
    return new Response(new Uint8Array(result.bytes), { headers: {
      'content-type': result.ref.mime, 'content-length': String(result.bytes.length),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store', 'etag': `"${result.ref.sha256}"`,
    } });
  });
  app.get('/v1/brain/artifacts/:id/metadata', async (c) => {
    const scope = ScopeSchema.safeParse({ workspace: c.req.query('workspace'), id: c.req.param('id') });
    if (!scope.success) return c.json({ error: 'Supply a valid workspace and artifact ID.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), scope.data.workspace);
    c.header('cache-control', 'no-store');
    return c.json(await service().artifactMetadata(c.get('actor'), scope.data.workspace, scope.data.id));
  });
  app.get('/v1/brain/artifacts/:id/preview', async (c) => {
    const scope = ScopeSchema.safeParse({ workspace: c.req.query('workspace'), id: c.req.param('id') });
    if (!scope.success) return c.json({ error: 'Supply a valid workspace and artifact ID.', code: 'INVALID_INPUT' }, 400);
    await machineScope(c.req.header('authorization'), scope.data.workspace);
    const result = await service().download(c.get('actor'), scope.data.workspace, scope.data.id, true);
    return new Response(new Uint8Array(result.bytes), { headers: {
      'content-type': result.ref.mime, 'content-length': String(result.bytes.length),
      'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store', 'etag': `"${result.ref.sha256}"`,
    } });
  });
}
