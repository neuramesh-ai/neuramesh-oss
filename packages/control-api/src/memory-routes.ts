import type {Hono} from 'hono';
import type {Actor} from '@neuramesh/shared';
import type {Store} from './store';
import {actorInWorkspace} from './credits';
import {DomainError} from './errors';
import {destinationReadActor} from './marketing-access';
export function memoryRoutes<E extends {Variables:{actor:Actor;memberId?:string;machine?:unknown;marketingContextAllowed?:boolean}}>(app:Hono<E>,store:Store) {
  app.get('/v1/memory', async (c) => {
    if(c.get('machine')&&c.get('actor').kind==='human'&&c.req.header('x-nm-agent-scopes')!=='1')return c.json({error:'Update this machine before reading private workspace context.'},403);
    const { workspace, channel } = c.req.query();
    if (!workspace || !channel) return c.json({ error: 'workspace and channel required' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    if (channel.startsWith('project:') && c.get('actor').kind !== 'human') return c.json({ error: 'Project memory requires workspace membership.', code: 'NOT_PERMITTED' }, 403);
    try {
      return c.json(await store.channelMemory(workspace, channel, await destinationReadActor(store,c.get('actor'),workspace,c.get('memberId')),c.get('marketingContextAllowed')));
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 404);
      throw err;
    }
  });

  app.post('/v1/recall', async (c) => {
    // D15: recall reads the project of the thread, project or channel the caller names (an agent with no
    // scope reads its own projects), never another project's memory
    if(c.get('machine')&&c.get('actor').kind==='human'&&c.req.header('x-nm-agent-scopes')!=='1')return c.json({error:'Update this machine before reading private workspace context.'},403);
    const b = (await c.req.json()) as { workspace?: string; channel?: string; threadId?: string; project?: string; query?: string; k?: number };
    if (!b.workspace || !b.query) return c.json({ error: 'workspace and query required', code: 'BAD_REQUEST' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), b.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const t0 = performance.now();
    try {
      const hits = await store.recall(b.workspace, b.channel ?? null, b.query, Math.min(b.k ?? 8, 25), { actor: await destinationReadActor(store,c.get('actor'),b.workspace,c.get('memberId')), thread: b.threadId ?? null, project: b.project ?? null,marketing:c.get('marketingContextAllowed') });
      return c.json({ hits, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      if (err instanceof DomainError) return c.json({ error: err.message, code: err.code }, err.status as 404);
      throw err;
    }
  });

}
