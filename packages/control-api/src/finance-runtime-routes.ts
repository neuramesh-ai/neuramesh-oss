import type {Hono} from 'hono';
import {z} from 'zod';
import type {Actor,FinanceChat} from '@neuramesh/shared';
import type {Store} from './store';
import {sqlOf} from './credits';
import {activeFinance,FinanceError} from './finance-gateway';
import {parseFinanceReply} from './finance-model';
import {claimFinanceJob,leasedFinanceJob,registerFinanceRuntime,finishFinanceJob,type FinanceJob} from './finance-runtime-store';
import {mayUse} from './member-machines';

export function financeRuntimeRoutes<E extends {Variables:{actor:Actor;machine?:unknown}}>(app:Hono<E>,store:Store,options:{fetch?:typeof fetch}={}) {
 for(const action of ['register','claim','validate','finish'])app.post(`/v1/finance/runtime/${action}`,async c=>{
  c.header('Cache-Control','private, no-store');
  const sql=sqlOf(store);if(!sql)return c.json({error:'Finance runtime requires the database.'},503);
  let job:FinanceJob|null=null;
  try{
   const body=z.object({workspace:z.string().uuid(),machineId:z.string().uuid(),id:z.string().uuid().optional(),lease:z.string().min(40).max(64).optional(),answer:z.string().max(30000).optional(),failed:z.boolean().optional()}).parse(await c.req.json());
   const actor=c.get('actor'),machine=c.get('machine') as {id:string;workspaceId:string}|undefined;
   if(actor.kind!=='human'||(machine&&(machine.id!==body.machineId||machine.workspaceId!==body.workspace)))throw new FinanceError('This runtime is not permitted.',403);
   const owner=machine?undefined:actor.id;
   if(!await registerFinanceRuntime(sql,body.machineId,body.workspace,owner))throw new FinanceError('This machine is unavailable.',403);
   if(action==='register')return c.json({ok:true});
   job=action==='claim'?await claimFinanceJob(sql,body.machineId,body.workspace):body.id&&body.lease?await leasedFinanceJob(sql,body.id,body.lease,body.machineId,body.workspace):null;
   if(!job){if(action==='claim')return c.json({job:null});throw new FinanceError('This Finance request expired or already finished.',409);}
   const [reach]=await sql`select m.kind,m.owner_user_id,coalesce(w.compute->'shares','[]'::jsonb) as shares from machines m join workspace_members w on w.workspace_id=m.workspace_id and w.user_id=m.owner_user_id where m.id=${job.machineId}::uuid and m.workspace_id=${job.workspace}::uuid and (m.lifecycle is null or m.lifecycle<>'destroyed')`;
   if(!reach||!mayUse({workspaceId:job.workspace,kind:reach.kind,ownerUserId:reach.owner_user_id,shares:reach.shares},job.requester))throw new FinanceError('Machine access changed.',403);
   const ctx=await activeFinance(store,{actor:{kind:'human',id:job.requester}},job.workspace,options.fetch);
   if(ctx.link.session!==job.session||(ctx.status.consentRevision??0)!==job.input.consentRevision||!ctx.status.capabilities.includes('transactions:read'))throw new FinanceError('Finance consent changed. Send the question again.',403);
   const chat=await store.finance!.getChat(job.workspace,job.session,job.chatId);
   if(!chat?.messages.some(m=>m.id===job!.id&&m.state==='pending'))throw new FinanceError('This Finance reply is no longer pending.',409);
   if(action==='claim')return c.json({job:{id:job.id,lease:job.lease,model:job.input.model,thinking:job.input.thinking,system:job.input.system,messages:job.input.messages.filter(m=>m.state==='complete').slice(-24).map(m=>({role:m.role,text:m.text}))}});
   if(action==='validate')return c.json({active:true});
   const reply=body.failed?{answer:'This model could not reply. Check its connection or choose another model.'}:parseFinanceReply(body.answer??'');
   const next:FinanceChat={...chat,revision:chat.revision+1,updatedAt:new Date().toISOString(),messages:chat.messages.map(m=>m.id===job!.id?{...m,text:reply.answer,state:body.failed?'failed':'complete',source:job!.input.source,...('budgetDraft' in reply&&reply.budgetDraft?{budgetDraft:reply.budgetDraft}:{})}:m)};
   await ctx.recheck();
   if(!await store.finance!.putChat(job.workspace,job.session,next,chat.revision))throw new FinanceError('The conversation changed. Reload it.',409);
   await finishFinanceJob(sql,job.id,!body.failed);return c.json({ok:true});
  }catch(error){
   if(job&&error instanceof FinanceError&&(error.status===403||error.status===409)){
    const chat=await store.finance!.getChat(job.workspace,job.session,job.chatId);
    if(chat?.messages.some(m=>m.id===job!.id&&m.state==='pending'))await store.finance!.putChat(job.workspace,job.session,{...chat,revision:chat.revision+1,updatedAt:new Date().toISOString(),messages:chat.messages.map(m=>m.id===job!.id?{...m,state:'failed',text:'Finance access changed. Review the connection and send your question again.'}:m)},chat.revision);
    await finishFinanceJob(sql,job.id,false);
   }
   if(error instanceof FinanceError)return c.json({error:error.message,code:error.code},error.status);
   if(error instanceof z.ZodError)return c.json({error:'Invalid Finance runtime request.'},400);
   console.error('finance_runtime_failed',{action,kind:error instanceof Error?error.name:'unknown'});return c.json({error:'Finance runtime is temporarily unavailable.'},503);
  }
 });
}
