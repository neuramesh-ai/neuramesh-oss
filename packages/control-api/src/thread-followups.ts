import type { Env, Hono } from 'hono';
import { z } from 'zod';
import type { Actor } from '@neuramesh/shared';
import { BrainError, brainThreadAccess } from './brain-store';
import { sqlOf } from './credits';
import type { Store } from './store';
import { fireWakeBump } from './fleet-lifecycle';

const scope = z.object({ workspace: z.string().uuid(), threadId: z.string().uuid() });
const write = scope.extend({ id: z.string().uuid() });
const workerScope = z.object({ workspace: z.string().uuid(), id: z.string().uuid() });
const files = z.array(z.object({id:z.string().uuid(), name:z.string().min(1).max(255), mime:z.string().max(255)})).max(24).default([]);
function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BrainError('INVALID_INPUT', 'Invalid follow-up request.', 400);
  return parsed.data;
}
const display = ['id','body','state','error','requested_steer','created_at'] as const;
type Machine = { id: string; workspaceId: string };

export function threadFollowupRoutes<E extends Env & { Variables: { actor: Actor; machine?: Machine } }>(app: Hono<E>, store: Store) {
  const db = () => { const sql = sqlOf(store); if (!sql) throw new BrainError('UNAVAILABLE','Follow-ups need the persistent store.',503); return sql; };
  const human = (actor: Actor, machine?: Machine) => {
    if (machine || actor.kind !== 'human') throw new BrainError('HUMAN_ONLY','Only a person can send or redirect a follow-up.',403);
    return actor.id;
  };
  const machine = (m: Machine | undefined, workspace: string) => {
    if (!m || m.workspaceId !== workspace) throw new BrainError('NOT_PERMITTED','This machine cannot deliver these prompts.',403);
    return m.id;
  };
  app.get('/v1/thread-followups', async c => {
    const {workspace,threadId} = validated(scope,c.req.query()), actor=c.get('actor'), sql=db();
    const author=human(actor,c.get('machine'));
    await brainThreadAccess(sql,actor,workspace,threadId);
    c.header('Cache-Control','private, no-store');
    return c.json(await sql`select ${sql([...display])} from thread_followups where workspace_id=${workspace} and thread_id=${threadId}
      and author_id=${author} and state not in ('delivered','cancelled') order by created_at,id`);
  });
  app.post('/v1/thread-followups', async c => {
    const {workspace,threadId,id,body,attachments} = validated(write.extend({body:z.string().trim().min(1).max(64000),attachments:files}),await c.req.json());
    const actor=c.get('actor'), author=human(actor,c.get('machine')), sql=db();
    await brainThreadAccess(sql,actor,workspace,threadId);
    const [row]=await sql`insert into thread_followups(id,workspace_id,thread_id,author_id,body,attachments,after_message_id,machine_id)
      select ${id},w.id,t.id,${author},${body},${sql.json(attachments ?? [])},
      (select m.id from messages m where t.kind='chat' and t.task_id is null and m.thread_id=t.id
       and m.author_kind='human' and not m.applied_followup order by m.created_at desc,m.id desc limit 1),
      coalesce(r.machine_id,cs.machine_id,t.machine_id,w.primary_machine_id)
      from workspaces w join threads t on t.workspace_id=w.id and t.id=${threadId}
      left join code_sessions cs on cs.workspace_id=w.id and cs.thread_id=t.id
      left join lateral (select machine_id from runs where workspace_id=w.id and (thread_id=t.id or task_id=t.task_id)
         and state in ('running','parked') order by started_at desc limit 1) r on true
      where w.id=${workspace} and t.archived_at is null
        and (not exists(select 1 from messages m where m.id=${id}) or exists(select 1 from thread_followups f where f.id=${id}))
      on conflict(id) do update set id=excluded.id where thread_followups.workspace_id=excluded.workspace_id and
        thread_followups.thread_id=excluded.thread_id and thread_followups.author_id=excluded.author_id and thread_followups.body=excluded.body and thread_followups.attachments=excluded.attachments
      returning ${sql([...display])}`;
    if (!row) throw new BrainError('CONFLICT','The follow-up could not be queued in this conversation.',409);
    fireWakeBump(store,workspace);return c.json(row);
  });
  app.post('/v1/thread-followups/action', async c => {
    const {workspace,threadId,id,action}=validated(write.extend({action:z.enum(['steer','remove'])}),await c.req.json());
    const actor=c.get('actor'), author=human(actor,c.get('machine')),sql=db();
    await brainThreadAccess(sql,actor,workspace,threadId);
    const [row]=await sql`update thread_followups set state=${action==='remove'?'cancelled':'steer'}, requested_steer=${action==='steer'},error=null,updated_at=now()
      where id=${id} and workspace_id=${workspace} and thread_id=${threadId} and author_id=${author} and state in ('queued','steer','failed') returning id`;
    if (!row) throw new BrainError('CONFLICT','This prompt has already been picked up. Refresh its status.',409);
    if (action==='steer') fireWakeBump(store,workspace);return c.json({ok:true});
  });
  app.get('/v1/thread-followups/pending', async c => {
    const {workspace}=validated(scope.pick({workspace:true}),c.req.query()),host=machine(c.get('machine'),workspace),sql=db();
    c.header('Cache-Control','no-store');
    // A lost acknowledgement is ambiguous. Never automatically replay a prompt that may
    // already have changed files. The person can inspect the thread and retry explicitly.
    await sql`update thread_followups set state='failed',error='Delivery was not confirmed. Check the conversation before retrying.',updated_at=now()
      where workspace_id=${workspace} and machine_id=${host} and state='applying' and updated_at<now()-interval '2 minutes'`;
    return c.json(await sql`select distinct on (f.thread_id) f.id,f.thread_id,f.author_id,f.body,f.attachments,f.requested_steer,t.kind,t.task_id,
      (exists(select 1 from runs r where r.workspace_id=f.workspace_id and (r.thread_id=t.id or r.task_id=t.task_id) and r.state in ('running','parked'))
       or exists(select 1 from code_sessions s where s.thread_id=t.id and s.state in ('streaming','awaiting_approval'))
       or exists(select 1 from messages trigger where trigger.id=f.after_message_id and trigger.created_at>now()-interval '2 minutes'
         and not exists(select 1 from runs r where r.trigger_message_id=trigger.id)
         and not exists(select 1 from messages a where a.thread_id=t.id and a.author_kind='agent' and a.reply_to=trigger.id))
      ) as busy
      from thread_followups f join threads t on t.id=f.thread_id and t.workspace_id=f.workspace_id join workspaces w on w.id=f.workspace_id
      where f.workspace_id=${workspace} and coalesce(f.machine_id,w.primary_machine_id,${host}::uuid)=${host} and f.state in ('queued','steer')
      and not exists(select 1 from thread_followups active where active.thread_id=f.thread_id and active.state='applying')
      and (f.requested_steer or not exists (
        select 1 from thread_followups prev where prev.thread_id=f.thread_id and prev.state='delivered' and not prev.handled_in_run
          and not exists(select 1 from runs r where r.trigger_message_id=prev.id and r.state not in ('running','parked'))
          and not exists(select 1 from messages m where (m.thread_id=t.id or m.task_id=t.task_id)
            and m.author_kind='agent' and m.reply_to=prev.id)
      ))
      order by f.thread_id,f.requested_steer desc,f.created_at,f.id`);
  });
  app.post('/v1/thread-followups/renew', async c=>{
    const {workspace,ids}=validated(z.object({workspace:z.string().uuid(),ids:z.array(z.string().uuid()).max(100)}),await c.req.json());
    const host=machine(c.get('machine'),workspace),sql=db();
    if(ids.length) await sql`update thread_followups set updated_at=now() where workspace_id=${workspace} and machine_id=${host}
      and state='applying' and id in ${sql(ids)}`;
    return c.json({ok:true});
  });
  app.post('/v1/thread-followups/claim', async c => {
    const {workspace,id,steer}=validated(workerScope.extend({steer:z.boolean()}),await c.req.json()),host=machine(c.get('machine'),workspace),sql=db();
    const row=await sql.begin(async tx=>{
      const [candidate]=await tx`select t.id from threads t join thread_followups f on f.thread_id=t.id where f.id=${id} and t.workspace_id=${workspace} for update of t`;
      if (!candidate) return null;
      const [head]=await tx`select id,state from thread_followups where thread_id=${candidate['id']} and state in ('queued','steer','applying')
        order by (state='applying') desc,requested_steer desc,created_at,id limit 1`;
      if (head?.['id']!==id || head['state']!==(steer?'steer':'queued')) return null;
      const [claimed]=await tx`update thread_followups set state='applying',machine_id=${host},updated_at=now() where id=${id}
        and (machine_id=${host} or (machine_id is null and exists(select 1 from workspaces w where w.id=${workspace} and coalesce(w.primary_machine_id,${host}::uuid)=${host})))
        and state=${steer?'steer':'queued'} returning id`;
      return claimed ?? null;
    });
    return c.json({claimed:!!row});
  });
  app.post('/v1/thread-followups/finish', async c => {
    const {workspace,id,result,reason}=validated(workerScope.extend({result:z.enum(['publish','applied','retry','failed']),reason:z.string().max(400).optional()}),await c.req.json());
    const host=machine(c.get('machine'),workspace),sql=db();
    await sql.begin(async tx=>{
      const [f]=await tx`select f.*,t.channel_id,t.task_id,t.archived_at from thread_followups f join threads t on t.id=f.thread_id and t.workspace_id=f.workspace_id
        where f.id=${id} and f.workspace_id=${workspace} and f.machine_id=${host} for update of f`;
      if (!f || !['applying','delivered'].includes(f['state'])) throw new BrainError('CONFLICT','This machine does not own the pending delivery.',409);
      if (f['state']==='delivered') return;
      if (result==='retry' || result==='failed' || f['archived_at']) {
        const state=result==='retry'&&!f['archived_at']?(f['requested_steer']?'steer':'queued'):'failed';
        await tx`update thread_followups set state=${state},error=${reason??null},updated_at=now() where id=${id}`;return;
      }
      // Unhandled task messages use the normal task wake route. A native steer is
      // recorded as human input but cannot start a parallel wake in another agent.
      const [published]=await tx`insert into messages(id,workspace_id,channel_id,task_id,thread_id,author_kind,author_id,body,applied_followup)
        values(${id},${workspace},${f['channel_id']},${f['task_id']},${f['task_id']&&result==='publish'?null:f['thread_id']},'human',${f['author_id']},${f['body']},${result==='applied'}) on conflict(id) do nothing returning id`;
      if (!published) {
        await tx`update thread_followups set state='failed',error='This message ID already exists. Remove the queued item and send a new prompt.',updated_at=now() where id=${id}`;
        return;
      }
      await tx`update thread_followups set state='delivered',handled_in_run=${result==='applied'},updated_at=now() where id=${id}`;
    });
    return c.json({ok:true});
  });
}
