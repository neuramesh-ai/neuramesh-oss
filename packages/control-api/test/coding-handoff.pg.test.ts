import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileBrainObjects} from '../src/brain-objects';
import postgres from 'postgres';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PostgresStore} from '../src/pgstore';
import {createApp} from '../src/app';
const url=process.env['DATABASE_URL']; const sql=url?postgres(url):null; const store=url?new PostgresStore(url):null; const app=store?createApp(store):null;
let user:string,workspace:string,project:string,channel:string,agent:string,other:string,home:string,repo:string;
const request=(body:unknown,id=agent)=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify({kind:'agent',id,role:'marketer'})},body:JSON.stringify(body)});
const input=()=>({type:'task.create',workspace,channel,originThread:home,codingHandoff:{requestId:randomUUID()},title:`Fix formatter ${randomUUID()}`,description:'Implement the README and run npm test.',kind:'bug',repo:{id:repo,baseRef:'main'},checklist:['Boundary tests pass'],plan:{legs:['build','review'],subtasks:[],approach:'Read the formatter, implement boundary checks and run its tests.'}});
const parentReports=(id:string)=>sql!`select m.body from messages m join tasks t on t.id=${id}::uuid
  where m.thread_id=${home}::uuid and (m.body like E'%\n\n#' || t.number
    or m.body like '%‹task-evidence:' || t.id || '›' or m.body like '%‹task:' || t.id || '›' or m.body like '%‹plan:' || t.id || ':v%›')`;
beforeAll(async()=>{
 if(!sql)return;
 const [u]=await sql`insert into nm_users(clerk_user_id,email) values(${randomUUID()},${`${randomUUID()}@coding.test`}) returning id`; user=u!['id'];
 const res=await app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify({kind:'human',id:user})},body:JSON.stringify({type:'workspace.create',name:'Coding handoff tests',slug:`coding-${randomUUID().slice(0,8)}`})});
 workspace=(await res.json() as {workspaceId:string}).workspaceId;
 await sql`update workspaces set plan='cloud' where id=${workspace}::uuid`;
 const [p]=await sql`select id,context_channel_id from projects where workspace_id=${workspace}::uuid and is_default`; project=p!['id'];channel=p!['context_channel_id'];
 const agents=await sql`insert into agents(workspace_id,name,role,runtime,model) values(${workspace}::uuid,'parent','marketer','codex','gpt-5.6-sol'),(${workspace}::uuid,'other','marketer','codex','gpt-5.6-sol') returning id,name`;
 await sql`insert into agents(workspace_id,name,role,runtime,model) values(${workspace}::uuid,'patch','developer','codex','gpt-5.6-sol')`;
 agent=agents.find(a=>a['name']==='parent')!['id'];other=agents.find(a=>a['name']==='other')!['id'];
 await sql`insert into project_agents(workspace_id,project_id,agent_id) values(${workspace}::uuid,${project}::uuid,${agent}::uuid),(${workspace}::uuid,${project}::uuid,${other}::uuid)`;
 const [h]=await sql`insert into threads(workspace_id,channel_id,project_id,home_agent_id,created_by,title,kind,mode) values(${workspace}::uuid,${channel}::uuid,${project}::uuid,${agent}::uuid,${`human:${user}`},'Parent','chat','chat') returning id`;home=h!['id'];
 const [r]=await sql`insert into repos(workspace_id,org_name,name,clone_url) values(${workspace}::uuid,'fixture','coding','https://example.test/fixture.git') returning id`;repo=r!['id'];
 await sql`insert into project_repos(project_id,repo_id,is_primary) values(${project}::uuid,${repo}::uuid,true)`;
});
afterAll(async()=>{await sql?.end();await store?.close();});
describe.skipIf(!url)('Agent Desk coding handoff',()=>{
 it('lets a non-orchestrator create a separate coding task while preserving the home and approval gate',async()=>{
   const body=input();const response=await request(body);expect(response.status,await response.clone().text()).toBe(200);
   const [task]=await sql!`select state,origin_thread_id from tasks where id=${body.codingHandoff.requestId}::uuid`;
   expect(task).toMatchObject({state:'plan_review',origin_thread_id:home});
   const [thread]=await sql!`select id,kind,created_by from threads where task_id=${body.codingHandoff.requestId}::uuid`;
   expect(thread).toMatchObject({kind:'coding',created_by:`human:${user}`});expect(thread!['id']).not.toBe(home);
   expect((await sql!`select kind,task_id from threads where id=${home}::uuid`)[0]).toMatchObject({kind:'chat',task_id:null});
   expect((await request(body)).status).toBe(200);
   expect(await sql!`select id from tasks where id=${body.codingHandoff.requestId}::uuid`).toHaveLength(1);
   expect((await request({...body,title:'Different request'})).status).toBe(422);
 });
 it('copies the selected developer home model and effort, never the parent model', async()=>{
   const [dev]=await sql!`select id from agents where workspace_id=${workspace}::uuid and name='patch'`;
   const [h]=await sql!`insert into threads(workspace_id,channel_id,project_id,home_agent_id,created_by,title,kind,mode,brain_override,home_thinking,origin)
     values(${workspace}::uuid,${channel}::uuid,${project}::uuid,${dev!['id']}::uuid,${`human:${user}`},'Developer home','chat','chat','{"developer":"gpt-5.6-sol"}'::jsonb,'high','web') returning id`;
   const body=input();expect((await request(body)).status).toBe(200);
   const [thread]=await sql!`select brain_override,home_thinking,origin from threads where task_id=${body.codingHandoff.requestId}::uuid`;
   expect(thread).toMatchObject({brain_override:{developer:'gpt-5.6-sol'},home_thinking:'high',origin:'web'});
   await sql!`update threads set brain_override='{"developer":"gemini-4-argon"}'::jsonb where id=${h!['id']}::uuid`;
   expect((await request(body)).status).toBe(200);
   expect((await sql!`select brain_override from threads where task_id=${body.codingHandoff.requestId}::uuid`)[0]!['brain_override']).toEqual({developer:'gpt-5.6-sol'});
 });
 it('publishes actionable parent plan cards and acknowledges approval exactly once', async()=>{
   const body=input();expect((await request(body)).status).toBe(200);
   const id=body.codingHandoff.requestId;
   const parent=()=>parentReports(id);
   expect((await parent()).some(r=>r['body']===`The implementation plan is ready to review below.\n‹plan:${id}:v1›`)).toBe(true);
   const human={kind:'human',id:user};
   const approve=()=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(human)},body:JSON.stringify({type:'task.approve_plan',taskId:id})});
   expect((await approve()).status).toBe(200);
   expect((await parent()).filter(r=>r['body'].includes('approval is saved'))).toHaveLength(1);
   await approve();
   expect((await parent()).filter(r=>r['body'].includes('approval is saved'))).toHaveLength(1);
   const acknowledgments = await sql!`select m.author_id, t.assignee_id from messages m join tasks t on t.id=m.task_id
     where t.id=${id}::uuid and m.author_kind='agent' and m.body='I received your approval for plan v1. Implementation is queued.'`;
   expect(acknowledgments).toHaveLength(1);
   expect(acknowledgments[0]!['author_id']).toBe(acknowledgments[0]!['assignee_id']);
   await sql!`select nm_coding_task_report(${id}::uuid,'runtime','awaiting_approval','npm test')`;
   expect((await parent()).some(r=>r['body']===`The coding agent needs your approval before it can continue. Open the live review below.\n‹task:${id}›`)).toBe(true);
   await sql!`insert into messages(workspace_id,channel_id,task_id,author_kind,author_id,body)
     values(${workspace}::uuid,${channel}::uuid,${id}::uuid,'agent',${agent}::uuid,${'Reconnect the coding model.\n```nmauth\n{}\n```'})`;
   expect((await parent()).some(r=>r['body'].includes('runtime reported an error') && r['body'].includes(`‹task:${id}›`))).toBe(true);
 });
 it('rejects another agent home and a repository outside the project',async()=>{
   expect((await request(input(),other)).status).toBe(403);
   const body=input();body.repo.id=randomUUID();expect((await request(body)).status).toBe(403);
 });
 it('adopts an unstarted existing task without replacing its messages or creating another task',async()=>{
   const seed=input();
   const [task]=await sql!`insert into tasks(workspace_id,channel_id,project_id,number,title,description,state,kind,creator_kind,creator_id)
     values(${workspace}::uuid,${channel}::uuid,${project}::uuid,900001,'Existing bug','Fix the formatter','todo','bug','agent',${agent}::uuid) returning id`;
   const id=String(task!['id']);
   const [message]=await sql!`insert into messages(workspace_id,channel_id,task_id,author_kind,author_id,body) values(${workspace}::uuid,${channel}::uuid,${id}::uuid,'human',${user}::uuid,'Keep this requirement') returning id`;
   const body={...seed,codingHandoff:{...seed.codingHandoff,taskId:id}};
   const response=await request(body);expect(response.status,await response.clone().text()).toBe(200);
   const [thread]=await sql!`select id,kind from threads where task_id=${id}::uuid`;expect(thread!['kind']).toBe('coding');
   expect((await sql!`select thread_id from messages where id=${message!['id']}::uuid`)[0]!['thread_id']).toBe(thread!['id']);
   expect(await sql!`select id from tasks where id=${seed.codingHandoff.requestId}::uuid`).toHaveLength(0);
   expect((await request(body)).status).toBe(200);
 });
 it('keeps a developer through plan revision, rejects takeover, and requires fresh approval',async()=>{
   const body=input();expect((await request(body)).status).toBe(200);
   const id=body.codingHandoff.requestId;
   const [created]=await sql!`select assignee_id,offered_agent_id from tasks where id=${id}::uuid`;
   const developer=String(created!['assignee_id']);expect(developer).toBe(created!['offered_agent_id']);
   const [architect]=await sql!`insert into agents(workspace_id,name,role,runtime,model) values(${workspace}::uuid,${`architect-${randomUUID()}`},'architect','claude','claude-haiku-4-5') returning id,name`;
   await sql!`insert into agent_channels(agent_id,channel_id) values(${architect!['id']}::uuid,${channel}::uuid)`;
   const command=(body:unknown,actor:{kind:string;id:string;role?:string})=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(actor)},body:JSON.stringify(body)});
   const human={kind:'human',id:user}, coder={kind:'agent',id:developer,role:'developer'}, arch={kind:'agent',id:String(architect!['id']),role:'architect'};
   expect((await command({type:'task.approve_plan',taskId:id},human)).status).toBe(200);
   expect((await command({type:'task.revise_plan',taskId:id,feedback:'Include actual screenshot validation of the delivered UI.'},human)).status).toBe(200);
   expect((await sql!`select state,assignee_id,plan_approved_at from tasks where id=${id}::uuid`)[0]).toMatchObject({state:'planning',assignee_id:developer,plan_approved_at:null});
   expect((await command({type:'task.propose_plan',taskId:id,plan:'Architecture takeover'},arch)).status).toBe(403);
   const response=await command({type:'task.propose_plan',taskId:id,plan:'Implement the formatter. Run npm test. For UI changes capture actual screenshots. Definition of done: tests pass and evidence is attached.'},coder);
   expect(response.status,await response.clone().text()).toBe(200);
   expect((await command({type:'task.offer',taskId:id,offerTo:architect!['name']},human)).status).toBe(403);
   expect((await command({type:'task.claim',taskId:id},coder)).status).not.toBe(200);
   expect((await command({type:'task.approve_plan',taskId:id},human)).status).toBe(200);
   expect((await command({type:'task.claim',taskId:id},arch)).status).toBe(403);
   expect((await command({type:'task.claim',taskId:id},coder)).status).toBe(200);
   expect((await sql!`select state,assignee_id from tasks where id=${id}::uuid`)[0]).toMatchObject({state:'in_progress',assignee_id:developer});
   expect(await sql!`select id from threads where task_id=${id}::uuid and kind='coding'`).toHaveLength(1);
 });
 it('persists state changes once in the parent thread, including the real PR',async()=>{
   const body=input();expect((await request(body)).status).toBe(200);
   await sql!`update tasks set state='in_progress' where id=${body.codingHandoff.requestId}::uuid`;
   const before=await sql!`select id from messages where thread_id=${home}::uuid and body like '%picked up the approved%'`;
   await sql!`update tasks set state='in_progress' where id=${body.codingHandoff.requestId}::uuid`;
   expect(await sql!`select id from messages where thread_id=${home}::uuid and body like '%picked up the approved%'`).toHaveLength(before.length);
   await sql!`update tasks set state='in_review',pr_url='https://github.com/fixture/code/pull/1' where id=${body.codingHandoff.requestId}::uuid`;
   const rows=await sql!`select body,author_id from messages where thread_id=${home}::uuid and body like '%Open pull request%'`;
   expect(rows[0]).toMatchObject({author_id:agent});expect(rows[0]!['body']).toContain('/pull/1');
 });
 it('keeps revised-plan cards in the task project when another project has the same channel slug',async()=>{
   const [p]=await sql!`insert into projects(workspace_id,name,slug) values(${workspace}::uuid,'Same channel name','same-channel') returning id`;
   const [c]=await sql!`insert into channels(workspace_id,project_id,slug) values(${workspace}::uuid,${p!['id']}::uuid,'general') returning id`;
   await sql!`update projects set context_channel_id=${c!['id']}::uuid where id=${p!['id']}::uuid`;
   await sql!`insert into project_repos(project_id,repo_id) values(${p!['id']}::uuid,${repo}::uuid)`;
   await sql!`insert into project_agents(workspace_id,project_id,agent_id) values(${workspace}::uuid,${p!['id']}::uuid,${agent}::uuid)`;
   const [h]=await sql!`insert into threads(workspace_id,channel_id,project_id,home_agent_id,created_by,title,kind,mode) values(${workspace}::uuid,${c!['id']}::uuid,${p!['id']}::uuid,${agent}::uuid,${`human:${user}`},'Other parent','chat','chat') returning id`;
   const body={...input(),channel:String(c!['id']),originThread:String(h!['id'])};expect((await request(body)).status).toBe(200);
   const id=body.codingHandoff.requestId;
   await sql!`update tasks set state='planning' where id=${id}::uuid`;
   const [t]=await sql!`select assignee_id from tasks where id=${id}::uuid`;
   const response=await app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify({kind:'agent',id:t!['assignee_id'],role:'developer'})},body:JSON.stringify({type:'task.propose_plan',taskId:id,plan:'Revised plan with tests and completion evidence.'})});
   expect(response.status,await response.clone().text()).toBe(200);
   const [thread]=await sql!`select id from threads where task_id=${id}::uuid`;
   const [message]=await sql!`select channel_id,thread_id from messages where task_id=${id}::uuid and body like '%‹plan:v2›%'`;
   expect(message).toMatchObject({channel_id:c!['id'],thread_id:thread!['id']});
 });
 it('throttles routine parent progress, retains urgent gates and includes the submitted summary',async()=>{
   const body=input();expect((await request(body)).status).toBe(200);
   const id=body.codingHandoff.requestId;
   await sql!`update coding_task_progress set reported_at=now()-interval '2 minutes' where task_id=${id}::uuid`;
   await sql!`select nm_coding_task_report(id,'runtime','working','Implement task #' || number || ': ' || title) from tasks where id=${id}::uuid`;
   await sql!`select nm_coding_task_report(${id}::uuid,'runtime','working','Boundary cases implemented; running the formatter tests.')`;
   await sql!`select nm_coding_task_report(${id}::uuid,'runtime','working','Checking another boundary.')`;
   let rows=await parentReports(id);
   expect(rows.find(r=>r['body'].includes('Boundary cases implemented'))?.['body']).toMatch(/^Implementation update: Boundary cases implemented; running the formatter tests\.\n\n#\d+$/);
   expect(rows.some(r=>r['body'].includes('Checking another boundary'))).toBe(false);
   await sql!`select nm_coding_task_report(${id}::uuid,'runtime','awaiting_approval','npm test')`;
   rows=await parentReports(id);
   expect(rows.some(r=>r['body'].includes('needs your approval'))).toBe(true);
   await sql!`insert into messages(workspace_id,channel_id,task_id,author_kind,author_id,body) values(${workspace}::uuid,${channel}::uuid,${id}::uuid,'agent',${agent}::uuid,'Pushed abc123. Implemented validation; npm test passed, 4 tests.')`;
   await sql!`update tasks set state='in_progress' where id=${id}::uuid`;
   await sql!`update tasks set state='in_review',pr_url='https://github.com/fixture/code/pull/2' where id=${id}::uuid`;
   rows=await parentReports(id);
   expect(rows.some(r=>r['body'].includes(body.title))).toBe(false);
   expect(rows.some(r=>r['body'].includes('npm test passed, 4 tests.') && r['body'].includes('/pull/2'))).toBe(true);
 });
 it('queues optional release preparation without approving the implementation or starting a release', async()=>{
   const body=input(), id=body.codingHandoff.requestId;
   expect((await request(body)).status).toBe(200);
   const [owner]=await sql!`select assignee_id from tasks where id=${id}::uuid`;
   const human={kind:'human',id:user}, dev={kind:'agent',id:owner!['assignee_id'],role:'developer'};
   const send=(actor:object,type:string,fields:object={})=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(actor)},body:JSON.stringify({type,taskId:id,...fields})});
   expect((await send(human,'task.approve_plan')).status).toBe(200);
   expect((await send(dev,'task.claim')).status).toBe(200);
   const submission=await send(dev,'task.submit',{sha:'a'.repeat(40),prNumber:99,prUrl:'https://github.com/fixture/code/pull/99',artifacts:[{kind:'doc',name:'review.md',content:'Local lifecycle fixture.'}]});
   expect(submission.status,await submission.clone().text()).toBe(200);
   const cmd={type:'task.request_release_checklist',taskId:id};
   expect((await request(cmd)).status).not.toBe(200);
   const ask=()=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify({kind:'human',id:user})},body:JSON.stringify(cmd)});
   for(const state of ['in_review','done']){
     if(state==='done') expect((await send(human,'task.approve')).status).toBe(200);
     const first=await ask();expect(first.status,await first.clone().text()).toBe(200);
     const before=await store!.getTask(id);
     expect(before?.state).toBe(state);expect(before?.workPlan?.codingDelivery?.prepareRelease).toBe(true);
     expect((await ask()).status).toBe(200);expect((await store!.getTask(id))?.version).toBe(before?.version);
   }
 });
 it('holds visual handoffs for paired evidence and keeps review and requested shipping with the developer', async()=>{
   const body=input();const id=body.codingHandoff.requestId;
   expect((await request({...body,codingHandoff:{...body.codingHandoff,visualEvidence:true}})).status).toBe(200);
   const [task]=await sql!`select assignee_id from tasks where id=${id}::uuid`;
   const [reviewer]=await sql!`insert into agents(workspace_id,name,role,runtime,model) values(${workspace}::uuid,${'review-'+randomUUID().slice(0,8)},'reviewer','codex','gpt-5.6-sol') returning id`;
   const human={kind:'human',id:user},dev={kind:'agent',id:task!['assignee_id'],role:'developer'};
   const command=(actor:object,type:string,fields:object={})=>app!.request('/v1/commands',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(actor)},body:JSON.stringify({type,taskId:id,...fields})});
   expect((await command(human,'task.approve_plan')).status).toBe(200);
   expect((await command(dev,'task.claim')).status).toBe(200);
   const submit={sha:'abcdef1234567890abcdef1234567890abcdef12',prNumber:8,prUrl:'https://github.com/fixture/code/pull/8'};
   expect((await command(dev,'task.submit',{...submit,artifacts:[{kind:'doc',name:'evidence.md',content:'Screenshots taken'}]})).status).not.toBe(200);
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=';
   const before={kind:'screenshot',name:'validation/before/home.png',content:image};
   expect((await command(dev,'task.submit',{...submit,artifacts:[before]})).status).not.toBe(200);
   const pair=[before,{...before,name:'validation/after/home.png'}];
   expect((await command(dev,'task.submit',{...submit,artifacts:pair})).status).not.toBe(200);
   const [th]=await sql!`select id from threads where task_id=${id}::uuid and kind='coding'`;
   async function verifyUpload(source:'managed-browser'|'independent-observer') {
     const root=await mkdtemp(join(tmpdir(),'nm-evidence-integrity-'));
     try {
       vi.stubEnv('NM_BRAIN_CLOUD_ONLY_WORKSPACES',workspace);
       const api=createApp(store!,{brain:{objects:new FileBrainObjects(root)}});
       const upload=(actor:object,body:unknown)=>api.request('/v1/brain/artifacts',{method:'POST',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(actor)},body:JSON.stringify(body)});
       for (const shot of pair) {
         const capture={source,target:'fixture:/home:1280x900:light',...(source==='independent-observer'?{reviewedRevision:submit.sha}:{})};
         const meta={workspace,threadId:th!['id'],id:randomUUID(),name:shot.name,mime:'image/png',kind:'file',contentBase64:image.split(',')[1],capture};
         expect((await upload(dev,meta)).status).toBe(403);
         if (source==='independent-observer') expect((await upload(human,{...meta,capture:{...capture,reviewedRevision:'0'.repeat(40)}})).status).not.toBe(200);
         const response=await upload(human,meta);expect(response.status,await response.clone().text()).toBe(200);
         expect((await upload(human,{...meta,capture:{...capture,target:'different-route'}})).status).not.toBe(200);
       }
     } finally {vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
   }
   await verifyUpload('managed-browser');
   const submitted=await command(dev,'task.submit',{...submit,artifacts:pair});
   expect(submitted.status,await submitted.clone().text()).toBe(200);
   expect((await parentReports(id)).some(row => row['body'].includes(`‹task-evidence:${id}›`))).toBe(true);
   expect((await command({kind:'agent',id:reviewer!['id'],role:'reviewer'},'task.approve')).status).not.toBe(200);
   const [shot]=await sql!`update artifacts set name='legacy-capture.png' where task_id=${id}::uuid and kind='screenshot' and name='validation/after/home.png' returning id`;
   expect((await command(dev,'task.approve')).status).not.toBe(200);
   await sql!`update artifacts set name='validation/after/home.png' where id=${shot!['id']}::uuid`;
   // A legacy submission can have different bytes from the real view. A fresh external
   // observation must refer to this exact revision before it can supersede those files.
   const previousBytes=Buffer.from(image.split(',')[1]!,'base64');previousBytes[32]=previousBytes[32]! ^ 1;
   await sql!`update artifacts set inline_content=${'data:image/png;base64,'+previousBytes.toString('base64')} where id=${shot!['id']}::uuid`;
   expect((await command(dev,'task.approve')).status).not.toBe(200);
   await verifyUpload('independent-observer');
   expect((await command(dev,'task.approve')).status).toBe(200);
   expect((await command(dev,'task.claim_ship')).status).not.toBe(200);
   await sql!`insert into messages(workspace_id,channel_id,task_id,author_kind,author_id,body)
     values(${workspace}::uuid,${channel}::uuid,${id}::uuid,'human',${user}::uuid,'Please ship it.')`;
   const prep=await command(dev,'task.accept'); expect(prep.status,await prep.clone().text()).toBe(200);
   const proposed=await command(dev,'task.propose_ship_plan',{report:'Verify deployment after merge.',risk:'low',summary:'Verify release',round:1,items:[{id:'smoke',title:'Check the deployed route',owner:'shipper'}]});
   expect(proposed.status,await proposed.clone().text()).toBe(200);
   expect((await command(dev,'task.approve_ship_plan')).status).not.toBe(200);
   expect((await command(dev,'task.execute_ship')).status).not.toBe(200);
   expect((await command(human,'task.approve_ship_plan')).status).toBe(200);
   expect((await command(dev,'task.check_ship_item',{itemId:'smoke',state:'done',note:'Smoke passed.'})).status).toBe(200);
   expect((await command(dev,'task.execute_ship')).status).toBe(200);
   expect((await sql!`select assignee_id,state from tasks where id=${id}::uuid`)[0]).toMatchObject({assignee_id:dev.id,state:'verifying'});
 });
 it('repairs old architect handoffs and orphaned cards without moving active or other specialist work',async()=>{
   const [architect]=await sql!`insert into agents(workspace_id,name,role,runtime,model) values(${workspace}::uuid,${`legacy-architect-${randomUUID()}`},'architect','codex','gpt-5.6-sol') returning id`;
   const bodies=[input(),input(),input()] as const;
   for(const body of bodies) expect((await request(body)).status).toBe(200);
   const ids=[bodies[0].codingHandoff.requestId,bodies[1].codingHandoff.requestId,bodies[2].codingHandoff.requestId] as const;
   await sql!`update tasks set assignee_id=${architect!['id']}::uuid where id in (${ids[0]}::uuid,${ids[1]}::uuid)`;
   await sql!`update tasks set state='in_progress' where id=${ids[1]}::uuid`;
   await sql!`update tasks set assignee_id=${other}::uuid where id=${ids[2]}::uuid`;
   const [orphan]=await sql!`insert into messages(workspace_id,channel_id,task_id,author_kind,author_id,body) values(${workspace}::uuid,${channel}::uuid,${ids[0]}::uuid,'agent',${agent}::uuid,'Preserve the revised plan card') returning id`;
   const migration=readFileSync(new URL('../../../supabase/migrations/0163_coding_task_ownership.sql',import.meta.url),'utf8');
   await sql!.unsafe(migration);
   const rows=await sql!`select id,assignee_id,offered_agent_id from tasks where id in (${ids[0]}::uuid,${ids[1]}::uuid,${ids[2]}::uuid)`;
   const repaired=rows.find(r=>r['id']===ids[0])!;
   expect(repaired['assignee_id']).toBe(repaired['offered_agent_id']);
   expect(rows.find(r=>r['id']===ids[1])!['assignee_id']).toBe(architect!['id']);
   expect(rows.find(r=>r['id']===ids[2])!['assignee_id']).toBe(other);
   const [thread]=await sql!`select id from threads where task_id=${ids[0]}::uuid`;
   expect((await sql!`select thread_id,body from messages where id=${orphan!['id']}::uuid`)[0]).toMatchObject({thread_id:thread!['id'],body:'Preserve the revised plan card'});
 });

});
