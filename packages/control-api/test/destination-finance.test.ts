import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {Hono} from 'hono';
import {createHmac,randomUUID} from 'node:crypto';
import type {Actor,DestinationPerson,FinanceSnapshot} from '@neuramesh/shared';
import {MemoryStore} from '../src/store';
import {destinationRoutes} from '../src/destinations';
import {financeRoutes} from '../src/finance';
import {financeWorkspaceRoutes} from '../src/finance-workspace';
import {financeChatRoutes} from '../src/finance-chat';
import {seal} from '../src/connector-crypto';
const workspace=randomUUID(),owner=randomUUID(),member=randomUUID(),agent=randomUUID(),outsider=randomUUID(),session=randomUUID();
const original={...process.env};
const person=(id:string,kind:'human'|'agent',isOwner=false):Omit<DestinationPerson,'hasAccess'>=>({id,kind,name:isOwner?'Owner':kind==='agent'?'Finance agent':'Member',role:isOwner?'owner':'member',description:null,owner:isOwner});
const snapshot:FinanceSnapshot={scope:{month:'2026-11',currency:'USD',availableCurrencies:['USD'],accountCount:3},freshness:{balancesAt:null,transactionsAt:null},summary:{spent:50,incoming:0,transactionCount:1,pendingCount:0},transactions:{items:[],nextCursor:null,total:1},spending:{categories:[{name:'Food',amount:50,count:1}],daily:[]},budgets:[],categories:['Food'],categoryOptions:[{name:'Food',group:'Food & Drink'}],warnings:[]};
function fixture() {
 const store=new MemoryStore();store.destinations.directory=async w=>w===workspace?[person(owner,'human',true),person(member,'human'),person(agent,'agent')]:[];
 let consentRevision:number|undefined=1;
 let active=true,modelCalls=0;let onModel:()=>Promise<void>=async()=>{};
 const calls:Array<{action:string;body:any;approval:string|null}>=[];
 const remote:typeof fetch=async(input,init)=>{
  const action=new URL(String(input)).pathname.split('/').pop()!,body=JSON.parse(String(init?.body));calls.push({action,body,approval:new Headers(init?.headers).get('X-Kinshi-Approval')});
  if(action==='status')return Response.json({consentRevision,state:active?'connected':'revoked',identity:{id:'kinshi',email:'sandbox@example.test'},accountCount:3,expiresAt:'2099-01-01T00:00:00.000Z',capabilities:['transactions:read','budgets:read','budgets:write']});
  if(action==='overview')return Response.json({...snapshot,secret:'must-not-leave-gateway'});
  if(action==='refresh')return Response.json({ok:true,transactionsAt:null,warnings:['Provider is preparing transactions.']});
  return Response.json({id:body.proposalId??randomUUID(),operation:'upsert',categoryName:'Food',budgetType:'category',currency:'USD',beforeLimit:null,afterLimit:200,version:null,expiresAt:'2099-01-01T00:00:00.000Z',state:action==='budget-commit'?'committed':action==='budget-dismiss'?'dismissed':'prepared'});
 };
 const model:typeof fetch=async(_input,init)=>{modelCalls++;expect(JSON.parse(String(init?.body)).store).toBe(false);await onModel();return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Posted spending for November 2026 is USD 50.'})}]}]});};
 const app=new Hono<{Variables:{actor:Actor;machine?:unknown;memberId?:string}}>();
 app.use('*',async(c,next)=>{c.set('actor',{kind:c.req.header('kind')==='agent'?'agent':'human',id:c.req.header('actor')??owner});if(c.req.header('machine'))c.set('machine',{});if(c.req.header('member'))c.set('memberId',c.req.header('member'));await next();});
 destinationRoutes(app,store);financeRoutes(app,store,{fetch:remote});financeWorkspaceRoutes(app,store,{fetch:remote});financeChatRoutes(app,store,{fetch:remote,modelFetch:model});
 const post=(path:string,body:Record<string,unknown>={},id=owner,kind='human',headers:Record<string,string>={})=>app.request('/v1/'+path,{method:'POST',headers:{'content-type':'application/json',actor:id,kind,...headers},body:JSON.stringify({workspace,...body})});
 const connect=()=>store.finance.withWorkspace(workspace,owner,async(_link,save)=>save({session,sealedSecret:seal('grant-secret'),origin:'https://kinshi.example',intent:'connect'}));
 return {store,post,connect,calls,omitRevision:()=>{consentRevision=undefined;},onModel:(fn:()=>Promise<void>)=>{onModel=fn;},revoke:()=>{active=false;},modelCalls:()=>modelCalls};
}
beforeEach(()=>{Object.assign(process.env,{NM_KINSHI_ORIGIN:'https://kinshi.example',NM_KINSHI_PARTNER_SECRET:'partner-key'.repeat(5),NM_CONNECTOR_KEY:'sealing-key'.repeat(5),NM_FINANCE_CHAT_URL:'http://127.0.0.1:8940/v1/responses',NM_FINANCE_CHAT_KEY:'unit-test-key'});});
afterEach(()=>{process.env={...original};});
describe('restricted workspace destinations',()=>{
 it('starts with owner-only access; Finance and Marketing grants are independent',async()=>{
  const f=fixture();const access=async(destination:string,id=owner)=>await(await f.post('destinations/access',{destination},id)).json() as any;
  expect((await access('finance')).people.filter((p:any)=>p.hasAccess)).toHaveLength(1);
  expect(await access('finance',outsider)).toMatchObject({canView:false,people:[]});
  expect((await f.post('destinations/member',{destination:'finance',kind:'human',id:member,on:true},member)).status).toBe(403);
  expect((await f.post('destinations/member',{destination:'finance',kind:'human',id:outsider,on:true})).status).toBe(400);
  expect((await f.post('destinations/member',{destination:'finance',kind:'human',id:owner,on:false})).status).toBe(409);
  await f.post('destinations/member',{destination:'finance',kind:'human',id:member,on:true});
  expect(await access('finance',member)).toMatchObject({canView:true,canManage:false});expect((await access('marketing',member)).canView).toBe(false);
  await f.post('destinations/member',{destination:'marketing',kind:'agent',id:agent,on:true});
  expect((await(await f.post('destinations/access',{destination:'marketing'},agent,'agent',{member})).json() as any).canView).toBe(false);
 });
 it('checks member/agent grants before any upstream Finance read and immediately honors removal',async()=>{
  const f=fixture();await f.connect();
  expect((await f.post('finance/overview',{month:'2026-11'},member)).status).toBe(403);expect(f.calls).toHaveLength(0);
  await f.store.destinations.set(workspace,'finance','human',member,true);
  const r=await f.post('finance/overview',{month:'2026-11'},member);expect(r.status).toBe(200);expect(await r.json()).not.toHaveProperty('secret');
  await f.store.destinations.set(workspace,'finance','human',member,false);
  expect((await f.post('finance/chats',{},member)).status).toBe(403);
  await f.store.destinations.set(workspace,'finance','agent',agent,true);
  expect((await f.post('finance/overview',{month:'2026-11'},agent,'agent')).status).toBe(200);
  expect((await f.post('finance/overview',{month:'2026-11'},agent,'agent',{member})).status).toBe(403);
 });
 it('only signs budget commits for an authenticated human owner',async()=>{
  const f=fixture();await f.connect();await f.store.destinations.set(workspace,'finance','human',member,true);const proposalId=randomUUID();
  for(const [id,kind,headers] of [[member,'human',{}],[owner,'human',{machine:'1'}],[agent,'agent',{}]] as const)expect((await f.post('finance/budget-commit',{proposalId},id,kind,headers)).status).toBe(403);
  expect(f.calls).toHaveLength(0);expect((await f.post('finance/budget-commit',{proposalId})).status).toBe(200);
  expect(f.calls.find(c=>c.action==='budget-commit')?.approval).toBe(createHmac('sha256',process.env.NM_KINSHI_PARTNER_SECRET!).update(`budget-commit\n${session}\n${proposalId}`).digest('hex'));
 });
});
describe('Finance conversation privacy and persistence',()=>{
 it('refuses an older partner contract before reading Finance data or contacting a model',async()=>{
  const f=fixture();await f.connect();f.omitRevision();
  const r=await f.post('finance/chat-send',{chatId:randomUUID(),requestId:randomUUID(),text:'Our spending?',month:'2026-11'});
  expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'KINSHI_UPDATE_REQUIRED'});expect(f.modelCalls()).toBe(0);expect(f.calls.every(c=>c.action==='status')).toBe(true);
 });
 it('persists a grounded reply, deduplicates a request and shares history only with Finance members',async()=>{
  const f=fixture();await f.connect();const input={chatId:randomUUID(),requestId:randomUUID(),text:'How much did we spend?',month:'2026-11',currency:'USD'};
  const first=await f.post('finance/chat-send',input);expect(first.status).toBe(200);const chat=await first.json() as any;
  expect(chat.messages).toHaveLength(2);expect(chat.messages[1].source).toMatchObject({month:'2026-11',currency:'USD',accountCount:3});
  expect((await f.post('finance/chat-send',input)).status).toBe(200);expect(f.modelCalls()).toBe(1);
  expect((await f.post('finance/chat-get',{id:input.chatId},member)).status).toBe(403);
  await f.store.destinations.set(workspace,'finance','human',member,true);expect(await(await f.post('finance/chat-get',{id:input.chatId},member)).json()).toEqual(chat);
  await f.store.finance.withWorkspace(workspace,owner,async(_link,save)=>save(null));expect((await f.post('finance/chat-get',{id:input.chatId})).status).toBe(409);
 });
 it('rechecks membership and consent after a long model call before returning an answer',async()=>{
  const f=fixture();await f.connect();await f.store.destinations.set(workspace,'finance','human',member,true);f.onModel(async()=>{await f.store.destinations.set(workspace,'finance','human',member,false);});
  const result=await f.post('finance/chat-send',{chatId:randomUUID(),requestId:randomUUID(),text:'Spending?',month:'2026-11'},member);expect(result.status).toBe(403);expect(await result.text()).not.toContain('USD 50');
 });
});
