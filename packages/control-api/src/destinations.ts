import type { Actor } from '@neuramesh/shared';
import { DestinationSchema } from '@neuramesh/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from './store';
import { destinationPermission } from './store/destinations';
export function destinationRoutes<E extends { Variables: { actor: Actor; machine?: unknown; memberId?: string } }>(app: Hono<E>, store: Store) {
  for (const action of ['access', 'member']) app.post(`/v1/destinations/${action}`, async c => {
    c.header('Cache-Control', 'no-store');
    const parsed = z.object({ workspace: z.string().uuid(), destination: DestinationSchema, kind: z.enum(['human','agent']).optional(), id: z.string().uuid().optional(), on: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Choose a workspace and destination.' }, 400);
    if (!store.destinations) return c.json({ error: 'Destination access is unavailable.' }, 503);
    const { workspace, destination, kind, id, on } = parsed.data;
    const actor = c.get('actor');
    if (c.get('machine') && actor.kind === 'human') return c.json({ error: 'Sign in to manage destination access.' }, 403);
    let access = await destinationPermission(store.destinations, actor, workspace, destination);
    const memberId = c.get('memberId');
    if (actor.kind === 'agent' && memberId && !(await destinationPermission(store.destinations,{kind:'human',id:memberId},workspace,destination)).canView) return c.json({destination,canManage:false,canView:false,people:[]});
    if (action === 'member') {
      if (!access.canManage || actor.kind !== 'human' || c.get('machine')) return c.json({ error: 'Only the workspace owner can change access.' }, 403);
      const target = access.people.find(p => p.id === id && p.kind === kind);
      if (!target || on === undefined) return c.json({ error: 'Choose a current workspace member or agent.' }, 400);
      if (target.owner) return c.json({ error: 'The workspace owner always has access.' }, 409);
      await store.destinations.set(workspace, destination, target.kind, target.id, on, actor.id);
      access = await destinationPermission(store.destinations, actor, workspace, destination);
    }
    return c.json(access);
  });
}
