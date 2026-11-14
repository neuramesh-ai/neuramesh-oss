import {afterEach,expect,it,vi} from 'vitest';
import {STARTER_MODEL,FinanceChatSchema,FinanceRequestModelSchema,type FinanceSnapshot} from '@neuramesh/shared';
import {completeFinanceBrain} from '../src/finance-brain';
import {MemoryStore} from '../src/store';
import type {Ledger} from '../src/credits';
const snapshot:FinanceSnapshot={scope:{month:'2026-11',currency:'USD',availableCurrencies:['USD'],accountCount:1},freshness:{balancesAt:null,transactionsAt:null},summary:{spent:42,incoming:0,transactionCount:1,pendingCount:0},transactions:{items:[],total:1,nextCursor:null},spending:{categories:[],daily:[]},budgets:[],categories:[],categoryOptions:[],warnings:[]};
afterEach(()=>vi.restoreAllMocks());
function ledger(remainingMicros=1000000){return {balance:vi.fn(async()=>({remainingMicros})),spend:vi.fn(async()=>({remainingMicros:99}))} as unknown as Ledger;}
it('refuses an exhausted credit balance before contacting a provider',async()=>{
 const request=vi.fn();await expect(completeFinanceBrain(new MemoryStore(),'workspace',[],snapshot,undefined,{ledger:ledger(0),key:'test-only',fetch:request})).rejects.toMatchObject({status:402,code:'NO_CREDITS'});expect(request).not.toHaveBeenCalled();
});
it('uses the house model without tools and charges actual input, output and thinking usage',async()=>{
 const l=ledger();const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));expect(body.tools).toBeUndefined();expect(body.generationConfig.responseMimeType).toBe('application/json');expect(body.systemInstruction.parts[0].text).toContain('"spent":42');expect(body.contents[0].role).toBe('user');
  return Response.json({candidates:[{content:{parts:[{text:'private thought',thought:true},{text:'{"answer":"November spending is USD 42."}'}]}}],usageMetadata:{promptTokenCount:111,candidatesTokenCount:22,thoughtsTokenCount:7}});
 });
 const reply=await completeFinanceBrain(new MemoryStore(),'workspace',[{id:crypto.randomUUID(),role:'user',text:'What did we spend?',at:new Date().toISOString(),state:'complete'}],snapshot,undefined,{ledger:l,key:'test-only',fetch:request});
 expect(reply).toMatchObject({model:STARTER_MODEL,answer:'November spending is USD 42.'});expect(l.spend).toHaveBeenCalledWith('workspace',expect.any(Number),{inTokens:111,outTokens:29});
});
it('still meters a completed call when the model returns invalid Finance JSON',async()=>{
 const l=ledger();await expect(completeFinanceBrain(new MemoryStore(),'workspace',[],snapshot,undefined,{ledger:l,key:'test-only',fetch:async()=>Response.json({candidates:[{content:{parts:[{text:'bad JSON'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:2}})})).rejects.toMatchObject({status:502});expect(l.spend).toHaveBeenCalledOnce();
});
it('keeps historical model selections readable while refusing retired models for new requests',()=>{
 expect(FinanceRequestModelSchema.safeParse('retired-model').success).toBe(false);
 expect(FinanceChatSchema.safeParse({id:crypto.randomUUID(),title:'Older conversation',revision:0,updatedAt:new Date().toISOString(),messages:[{id:crypto.randomUUID(),role:'assistant',text:'Saved reply',at:new Date().toISOString(),state:'complete',selection:{model:'retired-model',thinking:null}}]}).success).toBe(true);
});
