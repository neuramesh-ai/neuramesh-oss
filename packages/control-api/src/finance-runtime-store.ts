import {createHash,randomBytes} from 'node:crypto';
import type postgres from 'postgres';
import {type FinanceChatMessage,type FinanceModelSelection,type FinanceSnapshot,runtimeForModel} from '@neuramesh/shared';
import {seal,unseal} from './connector-crypto';
import {FinanceError} from './finance-gateway';
import {mayUse,wakeMachine} from './member-machines';
export interface FinanceRuntimeInput extends FinanceModelSelection {
 messages:FinanceChatMessage[];system:string;source:NonNullable<FinanceChatMessage['source']>;consentRevision:number;
}
export interface FinanceJob {id:string;workspace:string;session:string;chatId:string;requester:string;machineId:string;input:FinanceRuntimeInput;lease:string}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

export async function financeMachine(sql:postgres.Sql,workspace:string,requester:string,model:string):Promise<string> {
 const runtime=runtimeForModel(model);
 const rows=await sql`select m.id,m.kind,m.owner_user_id,m.runtimes,m.finance_chat_version,m.last_seen_at,coalesce(w.compute->'shares','[]'::jsonb) as shares
  from machines m join workspace_members w on w.workspace_id=m.workspace_id and w.user_id=m.owner_user_id
  where m.workspace_id=${workspace}::uuid and (m.lifecycle is null or m.lifecycle<>'destroyed')
  order by (m.owner_user_id=${requester}::uuid) desc,(m.kind='member') desc,m.last_seen_at desc nulls last`;
 const row=rows.find(m=>m.finance_chat_version>=1&&mayUse({workspaceId:workspace,kind:m.kind,ownerUserId:m.owner_user_id,shares:m.shares??[]},requester)
  &&(m.kind!=='local'||Date.now()-new Date(m.last_seen_at??0).getTime()<90000)&&Array.isArray(m.runtimes)&&m.runtimes.includes(runtime));
 if(!row)throw new FinanceError('No updated machine available to you can run this model. Connect its provider in Models, or choose NeuraMesh brain.',409,'MODEL_UNAVAILABLE');
 if(row.kind!=='local'&&(await wakeMachine(sql,row.id,{human:true})).capped)throw new FinanceError('Add credits to wake this machine, or choose another connected machine.',402,'NO_CREDITS');
 return row.id;
}
export async function registerFinanceRuntime(sql:postgres.Sql,machineId:string,workspace:string,owner:string|undefined) {
 const rows=await sql`update machines set finance_chat_version=1 where id=${machineId}::uuid and workspace_id=${workspace}::uuid
  and (${owner??null}::uuid is null or owner_user_id=${owner??null}::uuid) and (lifecycle is null or lifecycle<>'destroyed')
  and exists(select 1 from workspace_members w where w.workspace_id=machines.workspace_id and w.user_id=machines.owner_user_id) returning id`;
 return !!rows.length;
}
export async function enqueueFinanceJob(sql:postgres.Sql,job:{id:string;workspace:string;session:string;chatId:string;requester:string;machineId:string;input:FinanceRuntimeInput}) {
 await sql`insert into workspace_finance_model_jobs(id,workspace_id,kinshi_session,chat_id,requester_id,machine_id,model,thinking,sealed_input)
  values(${job.id}::uuid,${job.workspace}::uuid,${job.session}::uuid,${job.chatId}::uuid,${job.requester}::uuid,${job.machineId}::uuid,${job.input.model},${job.input.thinking},${seal(job.input)})`;
}
export async function claimFinanceJob(sql:postgres.Sql,machineId:string,workspace:string):Promise<FinanceJob|null> {
 await sql`update workspace_finance_model_jobs set state='failed',sealed_input='',lease_hash=null where machine_id=${machineId}::uuid and workspace_id=${workspace}::uuid and state in ('queued','running') and expires_at<=now()`;
 const lease=randomBytes(32).toString('base64url');
 const rows=await sql`update workspace_finance_model_jobs j set state='running',lease_hash=${hash(lease)} where j.id=(
  select p.id from workspace_finance_model_jobs p where p.machine_id=${machineId}::uuid and p.workspace_id=${workspace}::uuid and p.state='queued' and p.expires_at>now()
  order by p.created_at for update skip locked limit 1)
  returning j.*`;
 const r=rows[0];return r?{id:r.id,workspace:r.workspace_id,session:r.kinshi_session,chatId:r.chat_id,requester:r.requester_id,machineId:r.machine_id,input:unseal<FinanceRuntimeInput>(r.sealed_input),lease}:null;
}
export async function leasedFinanceJob(sql:postgres.Sql,id:string,lease:string,machineId:string,workspace:string):Promise<FinanceJob|null> {
 const [r]=await sql`select * from workspace_finance_model_jobs where id=${id}::uuid and machine_id=${machineId}::uuid and workspace_id=${workspace}::uuid
  and lease_hash=${hash(lease)} and state='running' and expires_at>now()`;
 return r?{id:r.id,workspace:r.workspace_id,session:r.kinshi_session,chatId:r.chat_id,requester:r.requester_id,machineId:r.machine_id,input:unseal<FinanceRuntimeInput>(r.sealed_input),lease}:null;
}
export async function finishFinanceJob(sql:postgres.Sql,id:string,ok:boolean) {
 await sql`update workspace_finance_model_jobs set state=${ok?'complete':'failed'},sealed_input='',lease_hash=null where id=${id}::uuid and state='running'`;
}
export const financeSource=(snapshot:FinanceSnapshot):NonNullable<FinanceChatMessage['source']>=>({month:snapshot.scope.month,currency:snapshot.scope.currency,accountCount:snapshot.scope.accountCount,transactionsAt:snapshot.freshness.transactionsAt});
