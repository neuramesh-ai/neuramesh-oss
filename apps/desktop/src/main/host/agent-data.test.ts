import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ReplicaBatch,ReplicaDatabase} from '@neuramesh/client-core/replica';
import {agentDataDb,withAgentData} from './agent-data';
import {agentDataIdentity} from './agent-data-context';
const workspace='w',agentId='agent',apiUrl='http://127.0.0.1:9999';
const snapshot=(body:string,allowed=true):ReplicaBatch=>({schemaVersion:1,cursor:'cursor',workspaces:allowed?[workspace]:[],changes:allowed?[{table:'artifacts',id:'visible',row:{id:'visible',workspace_id:workspace,inline_content:body}}]:[],hasMore:false});
const options={workspace,agentId,apiUrl,headers:async()=>({})};
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
