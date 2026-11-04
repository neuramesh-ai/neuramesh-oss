import { PERMISSION_MODES, type Actor, type PermissionSelection } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { brainThreadAccess, BrainError } from './brain-store';
import { sqlOf } from './credits';
import type { Store } from './store';
import { scheduledWake } from './store/permission-run';

const scope = z.object({ workspace: z.string().uuid(), threadId: z.string().uuid().optional(), taskId:z.string().uuid().optional() });
type Scope = z.infer<typeof scope>;

async function selection(sql: postgres.Sql, actor: Actor, target: Scope): Promise<PermissionSelection> {
  if (target.taskId) {
    if (target.threadId) throw new BrainError('INVALID_INPUT','Choose a thread or task.',400);
    const [task] = await sql<PermissionSelection[]>`select w.permission_mode as "workspaceMode",
      coalesce(th.permission_mode,k.permission_mode) as "threadMode",coalesce(th.legacy_coding_permissions,false) as "legacyControls",
      (k.permission_run_message_id is not null and k.state in ('planning','plan_review','in_progress')) as scheduled
      from tasks k join workspaces w on w.id=k.workspace_id left join threads th on th.task_id=k.id
      where k.id=${target.taskId} and w.id=${target.workspace} and (
        (${actor.kind}='human' and exists(select 1 from workspace_members m where m.workspace_id=w.id and m.user_id=${actor.id}))
        or (${actor.kind}='agent' and exists(select 1 from agent_channels ac join agents a on a.id=ac.agent_id
            where ac.channel_id=k.channel_id and a.id=${actor.id} and a.workspace_id=w.id and a.retired_at is null)))`;
    if (!task) throw new BrainError('NOT_FOUND','No accessible task.',404);
    return task;
  }
  if (target.threadId) await brainThreadAccess(sql, actor, target.workspace, target.threadId);
  else {
    const member = actor.kind === 'human' && await sql`select 1 from workspace_members
      where workspace_id=${target.workspace} and user_id=${actor.id}`;
    if (!member || !member.length) throw new BrainError('NOT_FOUND', 'No accessible workspace.', 404);
  }
  const [row] = await sql<PermissionSelection[]>`select w.permission_mode as "workspaceMode", t.permission_mode as "threadMode",
    coalesce(t.legacy_coding_permissions,false) as "legacyControls",
    (k.permission_run_message_id is not null and k.state in ('planning','plan_review','in_progress')) as scheduled
    from workspaces w left join threads t on t.workspace_id=w.id and t.id=${target.threadId ?? null}::uuid
    left join tasks k on k.id=t.task_id and k.workspace_id=w.id
    where w.id=${target.workspace}`;
  if (!row) throw new BrainError('NOT_FOUND', 'No accessible workspace.', 404);
  return row;
}

export function permissionRoutes<E extends Env & { Variables: { actor: Actor; memberId?:string; machine?: { id:string; workspaceId:string } } }>(app: Hono<E>, store: Store) {
  const db = () => { const sql = sqlOf(store); if (!sql) throw new BrainError('UNAVAILABLE', 'Permission storage is unavailable.', 503); return sql; };
  app.get('/v1/permissions', async c => {
    const parsed = scope.extend({ runId: z.string().uuid().optional() }).safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'Supply a valid workspace and optional thread.' }, 400);
    const sql = db(), actor = c.get('actor'), target = parsed.data;
    const machine = c.get('machine');
    if (machine && machine.workspaceId !== target.workspace) return c.json({ error: 'This machine belongs to a different workspace.' }, 403);
    c.header('Cache-Control', 'private, no-store');
    const current = await selection(sql, actor, target);
    if (target.runId && target.threadId && actor.kind === 'agent') {
      current.scheduled = !!await scheduledWake(sql,target.workspace,target.threadId,target.runId,actor.id,c.get('machine')?.id,c.get('memberId'));
    }
    const [hosts] = await sql`select coalesce(bool_and(permission_version>=1),false) as ready
      from machines where workspace_id=${target.workspace} and last_seen_at > now()-interval '2 minutes'`;
    return c.json({...current, runtimeReady: hosts?.ready === true});
  });
  app.post('/v1/permissions', async c => {
    const actor = c.get('actor');
    if (actor.kind !== 'human' || c.get('machine')) return c.json({ error: 'A human chooses the permission mode.' }, 403);
    const parsed = scope.extend({ mode: z.enum(PERMISSION_MODES).nullable() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || (!parsed.data.threadId && !parsed.data.taskId && !parsed.data.mode)) return c.json({ error: 'Choose a valid permission mode.' }, 400);
    const target = parsed.data;
    const result = await db().begin(async tx => {
      const sql = tx as unknown as postgres.Sql;
      const prior = await selection(sql, actor, target);
      if (prior.scheduled) throw new BrainError('NOT_PERMITTED','This scheduled task uses Turbo while it is running.',403);
      if (target.threadId) {
        const rows = await sql`update threads set permission_mode=${target.mode},legacy_coding_permissions=false
          where id=${target.threadId} and workspace_id=${target.workspace} and created_by=${'human:' + actor.id} and archived_at is null returning id`;
        if (!rows.length) throw new BrainError('NOT_PERMITTED', 'Only the owner of an active thread can change its permission mode.', 403);
      } else if (target.taskId) {
        const [row] = await sql`update tasks k set permission_mode=${target.mode} where k.id=${target.taskId} and k.workspace_id=${target.workspace}
          and not exists(select 1 from threads th where th.task_id=k.id)
          and ((k.creator_kind='human' and k.creator_id=${actor.id}) or exists(select 1 from workspace_members m where m.workspace_id=k.workspace_id and m.user_id=${actor.id} and m.role in ('owner','admin'))) returning id`;
        if (!row) throw new BrainError('NOT_PERMITTED','Use the owning conversation, or ask the task owner to change permissions.',403);
      } else {
        const rows = await sql`update workspaces w set permission_mode=${target.mode}
          where w.id=${target.workspace} and exists (select 1 from workspace_members m
          where m.workspace_id=w.id and m.user_id=${actor.id} and m.role in ('owner','admin')) returning id`;
        if (!rows.length) throw new BrainError('NOT_PERMITTED', 'A workspace administrator chooses the default permission mode.', 403);
      }
      return selection(sql, actor, target);
    });
    return c.json(result);
  });
}
