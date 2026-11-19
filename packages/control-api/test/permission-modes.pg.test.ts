import {createHash, randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApp} from '../src/app';
import {PostgresStore} from '../src/pgstore';

const url=process.env.DATABASE_URL;
const db=url?postgres(url):null, store=url?new PostgresStore(url):null, app=store?createApp(store):null;
const receiptBearer='nmm_'+randomUUID();
let user:string,workspace:string,project:string,channel:string,agent:string,machine:string,home:string,repo:string;
const headers=(id:string,kind='human',host=false)=>({'content-type':'application/json','x-nm-actor':JSON.stringify({kind,id,...(kind==='agent'?{role:'marketer'}:{})}),...(host?{authorization:'Bearer '+receiptBearer}:{})});
const post=(path:string,data:unknown,id=user,kind='human',host=false)=>app!.request(path,{method:'POST',headers:headers(id,kind,host),body:JSON.stringify(data)});
const get=(target:string,id=user,kind='human',host=false)=>app!.request('/v1/permissions?workspace='+workspace+target,{headers:headers(id,kind,host)});
const json=async<T>(response:Response):Promise<T>=>await response.json() as T;
const permissions=async(response:Response|Promise<Response>)=>json<import('@neuramesh/shared').PermissionSelection>(await response);
const coding=(run?:string)=>({type:'task.create',workspace,channel,originThread:home,permissionRunId:run,
  codingHandoff:{requestId:randomUUID()},title:'Implement receipt fixture '+randomUUID(),description:'Update the fixture and test its result.',
  kind:'bug',repo:{id:repo,baseRef:'main'},checklist:['Tests pass'],plan:{legs:['build','review'],subtasks:[],approach:'Inspect the repository, update the fixture and test its result.'}});

beforeAll(async()=>{
  if(!db)return;
  const [member]=await db`insert into nm_users(clerk_user_id,email) values(${randomUUID()},${randomUUID()+'@fixture.test'}) returning id`; user=member!.id;
  const created=await post('/v1/commands',{type:'workspace.create',name:'Permission fixture',slug:'permissions-'+randomUUID().slice(0,8)});
  expect(created.status).toBe(200); workspace=(await json<{workspaceId:string}>(created)).workspaceId;
  const [room]=await db`select id,project_id from channels where workspace_id=${workspace} and project_id is not null limit 1`;
  channel=room!.id;project=room!.project_id;
  const [host]=await db`insert into machines(workspace_id,owner_user_id,name,platform,kind,token_hash) values(${workspace},${user},'isolated fixture host','linux','member',${createHash('sha256').update(receiptBearer).digest('hex')}) returning id`; machine=host!.id;
  const [a]=await db`insert into agents(workspace_id,machine_id,name,role) values(${workspace},${machine},'permission-parent','marketer') returning id`;agent=a!.id;
  await db`insert into agents(workspace_id,machine_id,name,role) values(${workspace},${machine},'permission-coder','developer')`;
  await db`insert into project_agents(workspace_id,project_id,agent_id) values(${workspace},${project},${agent})`;
  await db`insert into agent_channels(agent_id,channel_id) values(${agent},${channel}) on conflict do nothing`;
  const [h]=await db`insert into threads(workspace_id,channel_id,project_id,home_agent_id,created_by,title,kind,mode) values(${workspace},${channel},${project},${agent},${'human:'+user},'Permission home','chat','chat') returning id`;home=h!.id;
  const [r]=await db`insert into repos(workspace_id,org_name,name,clone_url) values(${workspace},'fixture','permissions','https://example.test/fixture.git') returning id`;repo=r!.id;
  await db`insert into project_repos(project_id,repo_id,is_primary) values(${project},${repo},true)`;
});
afterAll(async()=>{await store?.close();await db?.end()});

describe.skipIf(!url)('thread modes at the authenticated HTTP boundary',()=>{
  it('applies workspace inheritance, a thread override, and reset; refuses other principals',async()=>{
    expect((await permissions(get('&threadId='+home))).workspaceMode).toBe('auto-review');
    expect((await post('/v1/permissions',{workspace,mode:'request-review'})).status).toBe(200);
    expect((await post('/v1/permissions',{workspace,threadId:home,mode:'auto-review'})).status).toBe(200);
    expect(await permissions(get('&threadId='+home))).toMatchObject({workspaceMode:'request-review',threadMode:'auto-review'});
    expect((await post('/v1/permissions',{workspace,threadId:home,mode:'turbo'},agent,'agent')).status).toBe(403);
    expect((await get('&threadId='+home,randomUUID())).status).toBe(404);
    expect((await post('/v1/permissions',{workspace,threadId:home,mode:'turbo'},user,'human',true)).status).toBe(403);
    expect((await get('&threadId='+home)).headers.get('Cache-Control')).toContain('no-store');
    expect((await permissions(get('&threadId='+home))).runtimeReady).toBe(false);
    const beat = await post('/v1/commands',{type:'machine.heartbeat',machineId:machine,permissionVersion:1},user,'human',true);
    expect(beat.status).toBe(200);
    expect((await permissions(get('&threadId='+home))).runtimeReady).toBe(true);
    expect((await post('/v1/permissions',{workspace,threadId:home,mode:'no-sandbox'})).status).toBe(400);
    expect(await (await post('/v1/permissions',{workspace,threadId:home,mode:null})).json()).toMatchObject({workspaceMode:'request-review',threadMode:null});
  });
  it('births a thread with the human choice; later messages cannot change it',async()=>{
    const threadId=randomUUID();const body={workspace,channel,threadId,body:'Fixture for permission storage'};
    expect((await post('/v1/messages',{...body,permissionMode:'default'})).status).toBe(200);
    expect((await post('/v1/messages',{...body,permissionMode:'turbo'})).status).toBe(200);
    expect((await permissions(get('&threadId='+threadId))).threadMode).toBe('default');
  });
  it('resolves permission grants only by ID, even for repeated questions', async () => {
    const question = 'Allow npm test?';
    const body = '```nmq\n'+JSON.stringify({kind:'permission',question,options:[{label:'Approve'},{label:'Deny'}]})+'\n```';
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const message = randomUUID();
      const response = await post('/v1/messages',{workspace,channel,threadId:home,id:message,body},agent,'agent',true);
      expect(response.status).toBe(200);
      const [row] = await db!`select id from decisions where message_id=${message}`;
      ids.push(row!.id);
    }
    await post('/v1/messages',{workspace,channel,threadId:home,body:'**Allow npm test?** → Approve'});
    const openCount = async () => (await db!`select id from decisions where id in ${db!(ids)} and status='open'`).length;
    expect(await openCount()).toBe(2);
    const answer = {type:'decision.answer',decisionId:ids[0],answer:'Approve'};
    expect((await post('/v1/commands',answer,user,'human',true)).status).toBe(403);
    expect((await post('/v1/commands',answer)).status).toBe(200);
    expect(await openCount()).toBe(1);
  });
  it('binds one scheduler claim to a wake and coding child; an ordinary reply stays interactive',async()=>{
    const [schedule]=await db!`insert into schedules(workspace_id,channel_id,title,cadence,owner_home_thread_id,created_by)
      values(${workspace},${channel},'Check storefront','daily',${home},${user}) returning id`;
    const scheduleId=schedule!.id;
    const claim=await post('/v1/commands',{type:'schedule.claim_run',schedule:scheduleId,runCount:0,nextRunAt:null},user,'human',true);
    expect(claim.status).toBe(200);const {schedulePermission}=await json<{schedulePermission:string}>(claim);expect(typeof schedulePermission).toBe('string');
    const message=randomUUID();
    const opener={workspace,channel,threadId:home,scheduleId,schedulePermission,body:'Check storefront'};
    const fired=await post('/v1/messages',{...opener,id:message},user,'human',true);
    expect(fired.status,await fired.clone().text()).toBe(200);
    expect(JSON.stringify(await fired.json())).not.toContain(schedulePermission);
    expect((await post('/v1/messages',{...opener,id:randomUUID()},user,'human',true)).status).toBe(403);
    const openWake=async(messageId:string)=>{
      const id=randomUUID();
      const response=await post('/v1/commands',{type:'run.open',workspace,channel,id,threadId:home,kind:'wake',title:'Checking storefront',total:0,triggerMessageId:messageId,machineId:machine},agent,'agent',true);
      expect(response.status,await response.clone().text()).toBe(200);return id;
    };
    const run=await openWake(message);
    const at='&threadId='+home+'&runId=';
    expect((await permissions(get(at+run,agent,'agent',true))).scheduled).toBe(true);
    expect((await permissions(get(at+run,agent,'agent'))).scheduled).toBe(false);
    const task=await post('/v1/commands',coding(run),agent,'agent',true);
    expect(task.status,await task.clone().text()).toBe(200);expect((await json<{task:{planApprovedAt:string|null}}>(task)).task.planApprovedAt).toBeTruthy();
    const ordinary=randomUUID();
    await post('/v1/messages',{workspace,channel,threadId:home,id:ordinary,scheduleId,body:'An interactive follow-up'});
    const humanRun=await openWake(ordinary);
    expect((await permissions(get(at+humanRun,agent,'agent',true))).scheduled).toBe(false);
    const interactive=await post('/v1/commands',coding(humanRun),agent,'agent',true);
    expect(interactive.status).toBe(200);expect((await json<{task:{planApprovedAt:string|null}}>(interactive)).task.planApprovedAt).toBeNull();
  });
});
