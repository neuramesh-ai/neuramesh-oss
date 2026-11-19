import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ReplicaBatch,ReplicaDatabase} from '@neuramesh/client-core/replica';
import {AGENT_DATA_LIMIT_MS,agentDataDb,withAgentData} from './agent-data';
import {agentDataIdentity} from './agent-data-context';
const workspace='w',agentId='agent',apiUrl='http://127.0.0.1:9999';
const snapshot=(body:string,allowed=true):ReplicaBatch=>({schemaVersion:1,cursor:'cursor',workspaces:allowed?[workspace]:[],changes:allowed?[{table:'artifacts',id:'visible',row:{id:'visible',workspace_id:workspace,inline_content:body}}]:[],hasMore:false});
const options={workspace,agentId,apiUrl,headers:async()=>({}),sleep:async()=>{}};
test('arbitrary library SQL reads only the scoped replica, never the owner cache',async()=>{
 let ownerReads=0;
 const db=agentDataDb<Pick<ReplicaDatabase,'getAll'>>({getAll:async<T>()=>{ownerReads++;return [{inline_content:'private owner data'}] as T[];}} satisfies Pick<ReplicaDatabase,'getAll'>,workspace);
 let calls=0;
 await withAgentData({...options,fetchImpl:async()=>Response.json(calls++===0?snapshot('public project data'):{...snapshot(''),changes:[]})},async()=>{
  assert.deepEqual((await db.getAll('select inline_content from artifacts')).map(row=>row.inline_content),['public project data']);
 });
 assert.equal(ownerReads,0);assert.equal(calls,2);
});
test('revocation resets and clears the in-memory projection before another read',async()=>{
 const db=agentDataDb<Pick<ReplicaDatabase,'getAll'>>({getAll:async()=>{throw new Error('owner fallback');}},workspace);let calls=0;
 await withAgentData({...options,fetchImpl:async()=>{calls++;return calls===1?Response.json(snapshot('private')):calls===2?new Response('',{status:409}):Response.json(snapshot('',false));}},async()=>{
  await assert.rejects(db.getAll('select inline_content from artifacts'),/add this agent/);
 });assert.equal(calls,3);
});
test('unavailable authorization fails closed and concurrent scopes stay independent',async()=>{
 const db=agentDataDb<Pick<ReplicaDatabase,'getAll'>>({getAll:async()=>{throw new Error('owner fallback');}},workspace);
 await assert.rejects(withAgentData({...options,fetchImpl:async()=>new Response('',{status:503})},async()=>{}),/could not be verified/);
 await Promise.all(['one','two'].map(id=>withAgentData({...options,agentId:id,fetchImpl:async()=>Response.json(snapshot(id))},async()=>{
  await new Promise(resolve=>setTimeout(resolve,id==='one'?10:1));
  assert.equal((await db.getAll('select inline_content from artifacts'))[0]?.inline_content,id);
  assert.equal(agentDataIdentity.getStore()?.agentId,id);
 })));
});
// A machine that just woke loads the agent's whole replica in its busiest seconds (George, 2026-11-17:
// "The operation was aborted due to timeout" posted as rex's reason). A bootstrap gets the longer limit,
// a slow or dropped read is tried again, and a read that stays slow says so in words a person reads.
const timeout=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
test('a bootstrap gets a longer limit than a change set',async()=>{
 assert.ok(AGENT_DATA_LIMIT_MS.bootstrap>=60_000&&AGENT_DATA_LIMIT_MS.changes===15_000);
 const limits:number[]=[];const real=AbortSignal.timeout;
 AbortSignal.timeout=(ms:number)=>{limits.push(ms);return real.call(AbortSignal,ms);};
 try{
  const db=agentDataDb<Pick<ReplicaDatabase,'getAll'>>({getAll:async()=>[]},workspace);let calls=0;
  await withAgentData({...options,fetchImpl:async()=>Response.json(calls++===0?snapshot('a'):{...snapshot(''),changes:[]})},async()=>{await db.getAll('select 1');});
 }finally{AbortSignal.timeout=real;}
 assert.deepEqual(limits,[AGENT_DATA_LIMIT_MS.bootstrap,AGENT_DATA_LIMIT_MS.changes]);
});
test('a slow, dropped or 5xx bootstrap is tried again, and the turn goes on',async()=>{
 for(const fail of [()=>{throw timeout();},()=>{throw new TypeError('fetch failed');},()=>new Response('',{status:503})]){
  let calls=0;const waits:number[]=[];
  await withAgentData({...options,sleep:async ms=>{waits.push(ms);},fetchImpl:async()=>calls++===0?fail():Response.json(snapshot('a'))},async()=>{});
  assert.equal(calls,2);assert.equal(waits.length,1);
 }
});
test('a bootstrap that stays slow fails in a sentence, never in Node\'s words, and a refusal is not retried',async()=>{
 let calls=0;
 await assert.rejects(withAgentData({...options,fetchImpl:async()=>{calls++;throw timeout();}},async()=>{}),(e:Error)=>e.message==='The workspace data did not load in time.');
 assert.equal(calls,3,'one try and two more');
 calls=0;
 await assert.rejects(withAgentData({...options,fetchImpl:async()=>{calls++;return new Response('',{status:403});}},async()=>{}),/could not be verified/);
 assert.equal(calls,1);
});
