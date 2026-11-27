import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const url=process.env.DATABASE_URL, sql=url?postgres(url):null,store=url?new PostgresStore(url):null,app=store?createApp(store):null;
const userId=randomUUID(), token='nmm_'+randomUUID(), other=randomUUID();
let workspace:string,threadId:string;
const request=(path:string,body?:unknown,actor=userId,machine=false)=>app!.request(path,{
  method:body?'POST':'GET',headers:{'content-type':'application/json',...(machine?{authorization:'Bearer '+token}:{'x-nm-actor':JSON.stringify({kind:'human',id:actor})})},
  ...(body?{body:JSON.stringify(body)}:{}),
});
beforeAll(async()=>{
  if(!sql) return;
  await sql`insert into nm_users(id,clerk_user_id,email) values(${userId},${randomUUID()},${userId+'@queue.test'}),(${other},${randomUUID()},${other+'@queue.test'})`;
  workspace=((await (await request('/v1/commands',{type:'workspace.create',name:'Follow-up fixture',slug:'q-'+userId.slice(0,8)})).json()) as {workspaceId:string}).workspaceId;
  const [project]=await sql`select id,context_channel_id from projects where workspace_id=${workspace} limit 1`;
  const [t]=await sql`insert into threads(workspace_id,project_id,channel_id,created_by,title,kind,mode) values
    (${workspace},${project!['id']},${project!['context_channel_id']},${'human:'+userId},'Queue fixture','chat','chat') returning id`;
  threadId=t!['id'];
  const [m]=await sql`insert into machines(workspace_id,owner_user_id,name,platform,kind,token_hash,last_seen_at) values
    (${workspace},${userId},'Test queue runner','darwin','member',${createHash('sha256').update(token).digest('hex')},now()) returning id`;
  await sql`update workspaces set primary_machine_id=${m!['id']} where id=${workspace}`;
});
afterAll(async()=>{await sql?.end();await store?.close();});
describe.skipIf(!url)('Thread follow-ups',()=>{
  it('persists drafts, protects their owner, promotes one, and publishes it exactly once on acknowledgement',async()=>{
    const id=randomUUID(),second=randomUUID(), scope={workspace,threadId};
    const add=(key:string,body:string)=>request('/v1/thread-followups',{...scope,id:key,body});
    expect((await add(id,'Keep the current fix scoped to the header.')).status).toBe(200);
    expect((await add(id,'Keep the current fix scoped to the header.')).status).toBe(200);
    expect((await add(id,'different input')).status).toBe(409);
    expect((await add(second,'Follow up after this turn.')).status).toBe(200);
    expect(await sql!`select id from messages where id in (${id},${second})`).toHaveLength(0);
    const action=(key:string,a:string,actor=userId)=>request('/v1/thread-followups/action',{...scope,id:key,action:a},actor);
    expect((await action(id,'steer',other)).ok).toBe(false);
    expect((await action(id,'steer')).ok).toBe(true);
    expect((await action(second,'remove')).ok).toBe(true);
    const inbox=await(await request('/v1/thread-followups?'+new URLSearchParams(scope))).json() as {id:string;state:string}[];
    expect(inbox.map((x:{id:string})=>x.id)).toEqual([id]);
    expect(inbox[0]?.state).toBe('steer');
    const asMachine=(path:string,body?:unknown)=>request('/v1/thread-followups/'+path,body,userId,true);
    expect((await request('/v1/thread-followups/pending?workspace='+workspace)).status).toBe(403);
    expect(((await(await asMachine('pending?workspace='+workspace)).json()) as {id:string}[]).map((x:{id:string})=>x.id)).toEqual([id]);
    const claims=await Promise.all([1,2].map(async()=> ((await(await asMachine('claim',{workspace,id,steer:true})).json()) as {claimed:boolean}).claimed));
    expect(claims.sort()).toEqual([false,true]);
    expect((await action(id,'remove')).status).toBe(409);
    for(let i=0;i<2;i++)expect((await asMachine('finish',{workspace,id,result:'applied'})).ok).toBe(true);
    expect(await sql!`select author_id,applied_followup from messages where id=${id}`).toEqual([{author_id:userId,applied_followup:true}]);
    expect(await(await request('/v1/thread-followups?'+new URLSearchParams(scope))).json()).toEqual([]);
  });
  it('keeps FIFO order across a chat wake and refuses a stale claim after a steer',async()=>{
    const first=randomUUID(), second=randomUUID(), scope={workspace,threadId};
    const call=(path:string,body?:unknown)=>request('/v1/thread-followups/'+path,body,userId,true);
    const claim=async(id:string,steer=false)=>((await (await call('claim',{workspace,id,steer})).json()) as {claimed:boolean}).claimed;
    for(const id of [first,second]) expect((await request('/v1/thread-followups',{...scope,id,body:'Run '+id})).ok).toBe(true);
    expect(await claim(second)).toBe(false);
    expect((await request('/v1/thread-followups/action',{...scope,id:second,action:'steer'})).ok).toBe(true);
    expect(await claim(second)).toBe(false);
    expect(await claim(first)).toBe(false);
    expect(await claim(second,true)).toBe(true);
    expect(await claim(first)).toBe(false);
    expect((await call('finish',{workspace,id:second,result:'applied'})).ok).toBe(true);
    expect(await claim(first)).toBe(true);
    expect((await call('finish',{workspace,id:first,result:'publish'})).ok).toBe(true);
    const [thread]=await sql!`select followup_count from threads where id=${threadId}`;
    expect(thread?.['followup_count']).toBe(0);
    expect(await sql!`select applied_followup from messages where id=${first}`).toEqual([{applied_followup:false}]);
    const third=randomUUID();
    await request('/v1/thread-followups',{...scope,id:third,body:'Wait for its answer'});
    expect(await (await call('pending?workspace='+workspace)).json()).toEqual([]);
    await request('/v1/thread-followups/action',{...scope,id:third,action:'remove'});
  });
});
