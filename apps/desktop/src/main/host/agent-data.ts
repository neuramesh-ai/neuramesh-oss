import {agentDataIdentity,type AgentDataIdentity} from './agent-data-context';
import {AsyncLocalStorage} from 'node:async_hooks';
import {SQLiteReplica} from '@neuramesh/client-core/sqlite-replica';
import type {ReplicaBatch,ReplicaDatabase} from '@neuramesh/client-core/replica';
import {controlApiRequestUrl} from '@neuramesh/shared';
import {sqliteDriver} from '../sync/sqlite-driver';
import {apiAuthHeaders} from '../apiauth';
import type {QueuedWork} from '../harness/hostqueue';
interface Identity {apiUrl:string;workspace:string;agentId:string;subject?:QueuedWork['subject'];callerId?:string}
interface Active extends Identity {db:SQLiteReplica;refresh:()=>Promise<void>}
const active=new AsyncLocalStorage<Active>();
interface Options extends Identity {fetchImpl?:typeof fetch;headers?:()=>Promise<Record<string,string>>}
/** Every model read uses a committed replica scoped to the actual agent and
 * conversation, never the workspace owner's broader desktop/machine cache. */
export async function withAgentData<T>(options:Options,run:()=>Promise<T>):Promise<T> {
 const current=active.getStore();
 if(current&&current.apiUrl===options.apiUrl&&current.workspace===options.workspace&&current.agentId===options.agentId&&current.callerId===options.callerId&&JSON.stringify(current.subject)===JSON.stringify(options.subject))return run();
 const identity:AgentDataIdentity={...options};
 const db=new SQLiteReplica(sqliteDriver(':memory:',{nodeSqlite:!process.versions.electron}));
 let cursor:string|undefined,inflight:Promise<void>|undefined;
 const refresh=async()=>{
  if(inflight)return inflight;
  const work=(async()=>{
   const query=new URLSearchParams({workspace:options.workspace});
   if(options.subject?.kind==='thread')query.set('thread',options.subject.id);
   if(options.subject?.kind==='task')query.set('task',String(options.subject.number));
   if(options.callerId)query.set('requester',options.callerId);
   if(cursor)query.set('cursor',cursor);
   const get=async(operation:string)=>(options.fetchImpl??fetch)(controlApiRequestUrl(options.apiUrl,`/v1/agent-replica/${operation}?${query}`),{headers:await(options.headers?.()??apiAuthHeaders(options.apiUrl,{kind:'agent',id:options.agentId})),signal:AbortSignal.timeout(15000),redirect:'error'});
   let bootstrap=!cursor,response=await get(bootstrap?'bootstrap':'changes');
   if(response.status===409&&!bootstrap){bootstrap=true;response=await get('bootstrap');}
   if(!response.ok){await response.body?.cancel();throw new Error('Agent data access could not be verified. Retry after checking channel membership.');}
   const batch=await response.json() as ReplicaBatch;await db.applyBatch(batch,bootstrap);cursor=batch.cursor;identity.privateDestination=batch.privateDestination;
   if(!batch.workspaces.includes(options.workspace))throw new Error('Ask the workspace owner to add this agent and requester to the channel.');
  })();inflight=work;
  try{await work;}finally{if(inflight===work)inflight=undefined;}
 };
 try{await refresh();return await agentDataIdentity.run(identity,()=>active.run({...options,db,refresh},run));}finally{await db.close();}
}
/** Internal routing/watches keep their owner cache. Reads inside a queued agent
 * flow use its independent in-memory replica; failures never fall back to owner data. */
export function agentDataDb<T extends Pick<ReplicaDatabase,'getAll'>>(source:T,workspace:string):T {
 return new Proxy(source,{get(target,key){
  if(key==='getAll'||key==='get'||key==='getOptional'||key==='execute')return async(sql:string,params:unknown[]=[])=>{
   const scope=active.getStore();
   if(!scope){const method=(target as unknown as Record<string,Function>)[String(key)];if(!method)throw new Error('Missing database read method.');return method.call(target,sql,params);}
   if(scope.workspace!==workspace)throw new Error('The agent cannot read a different workspace cache.');
   await scope.refresh();if(key==='execute')return scope.db.execute(sql,params);const rows=await scope.db.getAll(sql,params);if(key==='getAll')return rows;if(key==='getOptional')return rows[0]??null;if(!rows.length)throw new Error('This row is outside the agent channel context.');return rows[0];
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
export function agentDataAround(apiUrl:string,workspace:string) {
 return <T>(work:QueuedWork,run:()=>Promise<T>)=>withAgentData({apiUrl,workspace,agentId:work.agentId,subject:work.subject},run);
}
