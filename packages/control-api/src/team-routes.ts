import type { Actor } from '@neuramesh/shared';
import { MODEL_ID_SET, THINKING_LEVELS } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { sqlOf } from './credits';
import type { Store } from './store';
import { BrainError, brainThreadAccess } from './brain-store';
import { ensureTeamHomes, teamHomes, teamProjectAccess, teamContext, publishTeamContext } from './store/team-desk';
import { fireWakeBump } from './fleet-lifecycle';

const Scope = z.object({ workspace: z.string().uuid(), projectId: z.string().uuid() });
const ThreadScope = z.object({ workspace: z.string().uuid(), threadId: z.string().uuid() });
export function teamRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store) {
  const db = () => { const sql = sqlOf(store); if (!sql) throw new BrainError('UNAVAILABLE', 'Agent Desk requires the persistent store.', 503); return sql; };
  app.get('/v1/team', async c => {
    const p = Scope.safeParse(c.req.query()); if (!p.success) return c.json({ error: 'Supply a workspace and project.' }, 400);
    const channelId = await teamProjectAccess(db(), c.get('actor'), p.data.workspace, p.data.projectId);
    return c.json({ projectId: p.data.projectId, channelId, homes: await teamHomes(db(), p.data.workspace, p.data.projectId) });
  });
  app.post('/v1/team/open', async c => {
    const p = Scope.extend({ agentId: z.string().uuid().optional() }).safeParse(await c.req.json()); if (!p.success) return c.json({ error: 'Supply a valid project and agent.' }, 400);
    const { workspace, projectId, agentId } = p.data;
    await ensureTeamHomes(db(), c.get('actor'), workspace, projectId, agentId);
    return c.json({ projectId, channelId: await teamProjectAccess(db(), c.get('actor'), workspace, projectId), homes: await teamHomes(db(), workspace, projectId) });
  });
  app.get('/v1/team/context', async c => {
    const p = ThreadScope.safeParse(c.req.query()); if (!p.success) return c.json({ error: 'Supply a valid thread.' }, 400);
    return c.json(await teamContext(db(), c.get('actor'), p.data.workspace, p.data.threadId));
  });
  app.post('/v1/team/compact', async c => {
    const p = ThreadScope.extend({ revision: z.number().int().nonnegative(), through: z.string().uuid(), summary: z.string().min(1).max(16000) }).safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'Supply a valid context snapshot.' }, 400);
    return c.json(await publishTeamContext(db(), c.get('actor'), p.data.workspace, p.data.threadId, p.data));
  });
  app.post('/v1/team/model', async c => {
    const p = ThreadScope.extend({ model: z.string(), thinking: z.string().nullable() }).safeParse(await c.req.json());
    if (!p.success || !MODEL_ID_SET.has(p.data.model) || (p.data.thinking && !(THINKING_LEVELS as readonly string[]).includes(p.data.thinking))) return c.json({ error: 'Choose a supported model and effort.' }, 400);
    const actor = c.get('actor'); if (actor.kind !== 'human') throw new BrainError('HUMAN_ONLY', 'The model is a human choice.', 403);
    const sql = db(); await brainThreadAccess(sql, actor, p.data.workspace, p.data.threadId);
    const rows = await sql`update threads t set brain_override=jsonb_build_object(a.role,${p.data.model}::text), home_thinking=${p.data.thinking}
      from agents a where t.id=${p.data.threadId}::uuid and a.id=t.home_agent_id returning t.id`;
    if (!rows.length) throw new BrainError('NOT_FOUND', 'No agent thread found.', 404);
    return c.json({ ok: true });
  });
  app.get('/v1/team/history', async c => {
    const p = ThreadScope.extend({ before: z.string().uuid().optional(), sourceThreadId: z.string().uuid().optional() }).safeParse(c.req.query()); if (!p.success) return c.json({ error: 'Supply a valid thread.' }, 400);
    const sql = db(); const actor = c.get('actor'); const target = await brainThreadAccess(sql, actor, p.data.workspace, p.data.threadId);
    if (actor.kind === 'agent') {
      if (!p.data.sourceThreadId) throw new BrainError('NOT_PERMITTED', 'Supply the requesting agent thread.', 403);
      const source = await brainThreadAccess(sql, actor, p.data.workspace, p.data.sourceThreadId);
      const [home] = await sql`select home_agent_id from threads where id=${p.data.sourceThreadId}::uuid`;
      if (source.project_id !== target.project_id || home?.['home_agent_id'] !== actor.id) throw new BrainError('NOT_PERMITTED', 'Read agent threads within the current project.', 403);
    }
    const messages = await sql`select id,author_kind,author_id,body,created_at from messages where thread_id=${p.data.threadId}::uuid
      and (${p.data.before ?? null}::uuid is null or (created_at,id)<(select created_at,id from messages where id=${p.data.before ?? null}::uuid and thread_id=${p.data.threadId}::uuid))
      order by created_at desc,id desc limit 50`;
    return c.json({ messages, next: messages.length === 50 ? messages[49]!['id'] : null });
  });
  app.get('/v1/team/recall', async c => {
    const p = ThreadScope.extend({ query: z.string().trim().min(1).max(1000) }).safeParse(c.req.query());
    if (!p.success) return c.json({ error: 'Supply the agent thread and search text.' }, 400);
    const sql = db(); const scope = await brainThreadAccess(sql, c.get('actor'), p.data.workspace, p.data.threadId);
    const hits = await sql`select m.id,m.body,m.created_at from messages m join threads t on t.id=m.thread_id
      where t.workspace_id=${p.data.workspace}::uuid and t.project_id=${scope.project_id}::uuid
        and t.kind <> 'coding' and m.fts @@ websearch_to_tsquery('english',${p.data.query})
      order by ts_rank(m.fts,websearch_to_tsquery('english',${p.data.query})) desc,m.created_at desc limit 8`;
    return c.json({ hits });
  });
  app.post('/v1/team/message', async c => {
    const p = ThreadScope.extend({ targetThreadId: z.string().uuid(), id: z.string().uuid(), body: z.string().trim().min(1).max(12000) }).safeParse(await c.req.json());
    if (!p.success) return c.json({ error: 'Supply an agent thread and a message.' }, 400);
    const actor = c.get('actor'); if (actor.kind !== 'agent') throw new BrainError('NOT_PERMITTED', 'This is the agent collaboration tool.', 403);
    const sql = db(); const { workspace, threadId, targetThreadId, id, body } = p.data;
    await sql.begin(async tx => {
      const q = tx as unknown as typeof sql;
      const source = await brainThreadAccess(q, actor, workspace, threadId);
      const target = await brainThreadAccess(q, actor, workspace, targetThreadId);
      const [own] = await q`select home_agent_id from threads where id=${threadId}::uuid for update`;
      const [to] = await q`select t.home_agent_id from threads t join project_agents pa on pa.project_id=t.project_id and pa.agent_id=t.home_agent_id join agents a on a.id=pa.agent_id and a.retired_at is null where t.id=${targetThreadId}::uuid and t.archived_at is null`;
      if (source.project_id !== target.project_id || own?.['home_agent_id'] !== actor.id || !to?.['home_agent_id'] || threadId === targetThreadId) throw new BrainError('NOT_PERMITTED', 'Collaborate with another agent in this project.', 403);
      const [existing] = await q`select body,thread_id,team_source_thread_id from messages where id=${id}::uuid`;
      if (existing) { if (existing['body'] !== body || existing['thread_id'] !== targetThreadId || existing['team_source_thread_id'] !== threadId) throw new BrainError('CONFLICT', 'This request ID was already used.', 409); return; }
      const [trigger] = await q`select id,coalesce(team_depth,0)::int as depth from messages where thread_id=${threadId}::uuid and (author_kind='human' or team_source_thread_id is not null) order by created_at desc,id desc limit 1`;
      if (!trigger || trigger['depth'] >= 3) throw new BrainError('HANDOFF_LIMIT', 'This collaboration reached its handoff limit. Report the result to the person.', 409);
      const [sent] = await q`select count(*)::int as n from messages where team_source_thread_id=${threadId}::uuid and created_at >= (select created_at from messages where id=${trigger['id']}::uuid)`;
      if (sent!['n'] >= 4) throw new BrainError('HANDOFF_LIMIT', 'This request has already contacted four teammates. Wait for their work before asking for more.', 409);
      await q`insert into messages(id,workspace_id,channel_id,thread_id,author_kind,author_id,body,team_source_thread_id,team_depth)
        values(${id}::uuid,${workspace}::uuid,${target.channel_id}::uuid,${targetThreadId}::uuid,'agent',${actor.id}::uuid,${body},${threadId}::uuid,${trigger['depth'] + 1})`;
      await q`update threads set updated_at=now() where id=${targetThreadId}::uuid`;
    });
    fireWakeBump(store, workspace);
    return c.json({ ok: true, messageId: id, targetThreadId });
  });
}
