import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {afterEach,describe,expect,it} from 'vitest';
import {Hono} from 'hono';
import type {Actor} from '@neuramesh/shared';
import {MemoryStore} from '../src/store';
import {seal} from '../src/connector-crypto';
import {financeChatRoutes} from '../src/finance-chat';
import {financeMachine} from '../src/finance-runtime-store';
const url=process.env.NM_DESTINATION_TEST_DATABASE_URL??process.env.DATABASE_URL;
if(url&&!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Finance runtime tests require loopback Postgres.');
const original={...process.env};afterEach(()=>{process.env={...original};});
describe.skipIf(!url)('private Finance model queue on Postgres',()=>{
 it('isolates leases and compute access, persists selected models, rejects changed consent and clears private input',async()=>{
  Object.assign(process.env,{NM_CONNECTOR_KEY:'test-runtime-sealing-key'.repeat(3),NM_KINSHI_PARTNER_SECRET:'test-partner-key'.repeat(4),NM_KINSHI_ORIGIN:'https://kinshi.example'});
  const sql=postgres(url!,{max:1}),rollback=new Error('rollback');
  try{try{await sql.begin(async tx=>{
   const owner=randomUUID(),member=randomUUID(),workspace=randomUUID(),machine=randomUUID(),wrongMachine=randomUUID(),session=randomUUID(),chatId=randomUUID();let consentRevision=1;
   await tx`insert into nm_users(id,email) values(${owner},'finance-owner@test.invalid'),(${member},'finance-member@test.invalid')`;
   await tx`insert into workspaces(id,name,slug,created_by) values(${workspace},'Finance queue test',${'finance-'+workspace},${owner})`;
   await tx`insert into workspace_members(workspace_id,user_id,role) values(${workspace},${owner},'owner'),(${workspace},${member},'member')`;
   await tx`insert into machines(id,workspace_id,owner_user_id,name,kind,runtimes,last_seen_at) values(${machine},${workspace},${owner},'Finance test','local','["codex"]',now()),(${wrongMachine},${workspace},${member},'Other test','local','["codex"]',now())`;
   await tx`insert into workspace_finance_chats(id,workspace_id,kinshi_session,title,sealed_messages) values(${chatId},${workspace},${session},'FK fixture',${seal([])})`;
   const store=Object.assign(new MemoryStore(),{sql:tx});
   store.destinations.directory=async()=>[{id:owner,name:'Owner',kind:'human',role:'owner',description:null,owner:true},{id:member,name:'Member',kind:'human',role:'member',description:null,owner:false}];
   await store.finance.withWorkspace(workspace,owner,async(_,save)=>save({session,sealedSecret:seal('fixture-session-secret'),origin:'https://kinshi.example',intent:'connect'}));
   const app=new Hono<{Variables:{actor:Actor;machine?:unknown}}>();app.use('*',async(c,next)=>{c.set('actor',{kind:'human',id:c.req.header('actor')??owner});const id=c.req.header('machine');if(id)c.set('machine',{id,workspaceId:workspace});await next();});
   const remote:typeof fetch=async(input)=>Response.json(String(input).endsWith('/status')?{state:'connected',identity:{id:'kinshi',email:null},accountCount:1,expiresAt:'2099-01-01T00:00:00.000Z',capabilities:['transactions:read'],consentRevision}:{scope:{month:'2026-11',currency:'USD',availableCurrencies:['USD'],accountCount:1},freshness:{balancesAt:null,transactionsAt:null},summary:{spent:42,incoming:0,transactionCount:1,pendingCount:0},transactions:{items:[],total:1,nextCursor:null},spending:{categories:[],daily:[]},budgets:[],categories:[],warnings:[]});
   financeChatRoutes(app,store,{fetch:remote});
   const post=(action:string,body:Record<string,unknown>={},runtime?:string,actor=owner)=>app.request('/v1/finance/'+action,{method:'POST',headers:{'content-type':'application/json',actor,...(runtime?{machine:runtime}:{})},body:JSON.stringify({workspace,machineId:runtime??machine,...body})});
   // Older machines cannot accidentally receive private context.
   await expect(financeMachine(tx as unknown as postgres.Sql,workspace,owner,'gpt-5.6-sol')).rejects.toMatchObject({status:409});
   expect((await post('runtime/register',{},machine)).status).toBe(200);
   await expect(financeMachine(tx as unknown as postgres.Sql,workspace,member,'gpt-5.6-sol')).rejects.toMatchObject({status:409});
   const send=await post('chat-send',{chatId,requestId:randomUUID(),text:'What did we spend?',month:'2026-11',model:'gpt-5.6-sol',thinking:'high'});expect(send.status).toBe(200);
   const pending=await send.json() as any;expect(pending.messages[1]).toMatchObject({state:'pending',selection:{model:'gpt-5.6-sol',thinking:'high'}});
   const [encrypted]=await tx`select * from workspace_finance_model_jobs where chat_id=${chatId}`;expect(encrypted!.sealed_input).not.toContain('What did we spend?');
   expect(await(await post('runtime/claim',{},wrongMachine,member)).json()).toEqual({job:null});
   const claim=await(await post('runtime/claim',{},machine)).json() as any;expect(claim.job.model).toBe('gpt-5.6-sol');expect(claim.job.system).toContain('"spent":42');expect(claim.job.messages).toHaveLength(1);
   expect(await(await post('runtime/claim',{},machine)).json()).toEqual({job:null});
   const finish={id:claim.job.id,lease:claim.job.lease,answer:'{"answer":"November spending is USD 42."}'};
   expect((await post('runtime/finish',{...finish,lease:'x'.repeat(43)},machine)).status).toBe(409);
   expect((await post('runtime/finish',finish,wrongMachine,member)).status).toBe(409);
   // Same grant ID, newly reconfirmed account selection: discard the old answer.
   consentRevision++;
   expect((await post('runtime/finish',finish,machine)).status).toBe(403);
   const rejected=await store.finance.getChat(workspace,session,chatId);expect(rejected!.messages[1]!.state).toBe('failed');expect(rejected!.messages[1]!.text).not.toContain('USD 42');
   const [cleared]=await tx`select state,sealed_input,lease_hash from workspace_finance_model_jobs where id=${claim.job.id}`;expect(cleared).toMatchObject({state:'failed',sealed_input:'',lease_hash:null});
   // A fresh request after consent succeeds once, retaining server-derived provenance.
   expect((await post('chat-send',{chatId,requestId:randomUUID(),text:'Retry with new consent',month:'2026-11',model:'gpt-5.6-sol'})).status).toBe(200);
   const next=await(await post('runtime/claim',{},machine)).json() as any;
   const answer={id:next.job.id,lease:next.job.lease,answer:finish.answer};expect((await post('runtime/finish',answer,machine)).status).toBe(200);expect((await post('runtime/finish',answer,machine)).status).toBe(409);
   expect((await store.finance.getChat(workspace,session,chatId))!.messages.at(-1)).toMatchObject({state:'complete',source:{month:'2026-11',currency:'USD',accountCount:1}});
   // An explicitly shared local machine can serve another granted Finance member.
   await tx`update machines set lifecycle='destroyed' where id=${wrongMachine}`;
   await tx`update workspace_members set compute=${tx.json({shares:[member]})} where workspace_id=${workspace} and user_id=${owner}`;
   await store.destinations.set(workspace,'finance','human',member,true);
   expect((await post('chat-send',{chatId,requestId:randomUUID(),text:'Shared compute question',month:'2026-11',model:'gpt-5.6-sol'},undefined,member)).status).toBe(200);
   const shared=await(await post('runtime/claim')).json() as any;expect(shared.job.messages.at(-1).text).toBe('Shared compute question');
   // The local owner must still own the machine; another member cannot claim it.
   expect((await post('runtime/validate',{id:shared.job.id,lease:shared.job.lease},undefined,member)).status).toBe(403);
   // Removing the compute owner also removes this machine as a Finance executor.
   await tx`delete from workspace_members where workspace_id=${workspace} and user_id=${owner}`;
   await expect(financeMachine(tx as unknown as postgres.Sql,workspace,member,'gpt-5.6-sol')).rejects.toMatchObject({status:409});
   expect((await post('runtime/validate',{id:shared.job.id,lease:shared.job.lease})).status).toBe(403);
   throw rollback;
  });}catch(error){if(error!==rollback)throw error;}}finally{await sql.end();}
 });
});
