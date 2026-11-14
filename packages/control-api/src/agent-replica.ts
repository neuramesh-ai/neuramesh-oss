import type {Actor} from '@neuramesh/shared';
import type {Hono} from 'hono';
import {z} from 'zod';
import {sqlOf} from './credits';
import type {Store} from './store';
import {localBootstrap,readChanges,decodeLocalCursor} from './local-sync';
import type {AgentReplicaPrincipal} from './agent-replica-scope';
export function agentReplicaRoutes<E extends {Variables:{actor:Actor;memberId?:string}}>(app:Hono<E>,store:Store) {
 app.get('/v1/agent-replica/:operation',async c=>{
  c.header('Cache-Control','private, no-store');
  const actor=c.get('actor');if(actor.kind!=='agent')return c.json({error:'An authenticated agent is required.'},403);
  const parsed=z.object({workspace:z.string().uuid(),requester:z.string().uuid().optional(),thread:z.string().uuid().optional(),task:z.coerce.number().int().positive().optional()}).safeParse(c.req.query());
  if(!parsed.success||parsed.data.thread&&parsed.data.task)return c.json({error:'Choose one agent conversation context.'},400);
  const sql=sqlOf(store);if(!sql)return c.json({error:'Agent context requires the database.'},503);
  const principal:AgentReplicaPrincipal={kind:'scoped-agent',id:actor.id,workspaceId:parsed.data.workspace,...((c.get('memberId')??parsed.data.requester)?{callerId:c.get('memberId')??parsed.data.requester}:{}),...(parsed.data.thread?{subject:{kind:'thread',id:parsed.data.thread}}:parsed.data.task?{subject:{kind:'task',number:parsed.data.task}}:{})};
  if(c.req.param('operation')==='bootstrap')return c.json(await localBootstrap(sql,principal));
  if(c.req.param('operation')!=='changes')return c.json({error:'Unknown agent replica operation.'},404);
  const cursor=decodeLocalCursor(c.req.query('cursor')??'');if(!cursor)return c.json({error:'A fresh agent snapshot is required.',code:'RESET_REQUIRED'},409);
  const read=await readChanges(sql,principal,cursor);return read?c.json(read.batch):c.json({error:'A fresh agent snapshot is required.',code:'RESET_REQUIRED'},409);
 });
}
