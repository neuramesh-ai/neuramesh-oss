import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineeringTaskSession } from './engineering-task-session';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
const meta: EngineeringMachineOpenMeta = {actorId:'owner',threadId:'task-thread',repoId:'repo',repoName:'fixture',branch:'test',mode:'act',permissions:{read:true,edit:false,command:false,web:false,mcp:false},policy:{read:true,edit:true,command:true,web:true,mcp:true}};

test('a late pane sees the live approval; closing it does not abort delegated work', async () => {
  const task = new EngineeringTaskSession(meta); let closed=0; const commands:unknown[]=[];
  task.bind({command:v=>commands.push(v),close:()=>{closed++;},busy:true});
  task.emit({type:'approval',approvalId:'approve-edit',category:'edit',toolName:'apply_patch',input:{}});
  const events:EngineeringRuntimeEvent[]=[];
  const pane=task.attach(e=>events.push(e));
  const snapshot=events.find(e=>e.type==='task_state');
  assert.equal(snapshot?.type==='task_state' && snapshot.session.pendingApproval?.id,'approve-edit');
  pane.command({type:'approval',approvalId:'approve-edit',approved:true});
  assert.equal(commands.length,1);
  await pane.close(); assert.equal(closed,0);
  task.emit({type:'status',status:'running'}); assert.equal(events.length,1);
  await task.close(); assert.equal(closed,1);
});

test('a stopped task aborts its runtime and cannot claim delivery', async () => {
  const task = new EngineeringTaskSession(meta); const commands:unknown[]=[];
  task.bind({command:v=>commands.push(v),close:()=>{},busy:true});
  await assert.rejects(task.run('Implement the fixture',()=>true),/__stopped__/);
  assert.deepEqual(commands.at(-1),{type:'abort'});
});

test('runtime failure does not become a successful coding task summary', async () => {
  const task = new EngineeringTaskSession(meta);
  task.bind({command:()=>task.emit({type:'error',message:'Provider refused the model',recoverable:false}),close:()=>{},busy:false});
  await assert.rejects(task.run('Implement',()=>false),/Provider refused/);
});

test('a retry that produces no answer cannot submit a previous turn as its new result', async () => {
  const task = new EngineeringTaskSession(meta);
  task.emit({type:'agent_event',event:{type:'agent_event',payload:{event:{type:'done',text:'Previous implementation summary',reason:'completed'}}}});
  task.bind({command:()=>task.emit({type:'ended',reason:'completed'}),close:()=>{},busy:false});
  await assert.rejects(task.run('Implement the requested changes',()=>false),/without an implementation summary/);
});

test('a completed task flushes the native recording before returning its current result', async () => {
  const task = new EngineeringTaskSession(meta); let flushed=false;
  task.bind({command:()=>{
    task.emit({type:'agent_event',event:{type:'agent_event',payload:{event:{type:'done',text:'Implemented the formatter; npm test passed.',reason:'completed'}}}});
    task.emit({type:'ended',reason:'completed'});
  },close:()=>{},busy:false,flush:async()=>{flushed=true;}});
  assert.equal(await task.run('Implement the formatter',()=>false),'Implemented the formatter; npm test passed.');
  assert.equal(flushed,true);
});


test('task panes cannot bypass the plan gate or replace the assigned agent', () => {
  const task = new EngineeringTaskSession({...meta,mode:'plan'}); const commands:unknown[]=[];
  task.bind({command:value=>commands.push(value),close:()=>{}});
  const events:EngineeringRuntimeEvent[]=[];const pane=task.attach(event=>events.push(event));
  for (const value of [{type:'controls',controls:{mode:'act'}},{type:'configure',selection:{agentId:'architect'}},{type:'prompt',prompt:'Implement without approval'}]) pane.command(value);
  assert.equal(commands.length,0); assert.equal(events.filter(e=>e.type==='error').length,3);
});

test('an implementation pane restores history without reverting to the prior planning mode or specialist', () => {
  const task = new EngineeringTaskSession({...meta,agentId:'developer',modelId:'current-model'});
  task.restore({workspace:'workspace',threadId:meta.threadId,revision:1,events:[
    {id:'prior',type:'user.message',timestamp:'2026-10-30T12:00:00Z',payload:{text:'Revise the plan',mode:'plan'}},
  ],metadata:{mode:'plan',selection:{agentId:'architect',modelId:'old-model',reasoningEffort:null}}});
  const events:EngineeringRuntimeEvent[]=[]; task.attach(event=>events.push(event));
  const snapshot=events.find(event=>event.type==='task_state');
  assert.equal(snapshot?.type,'task_state');
  if (snapshot?.type!=='task_state') throw new Error('Missing task state');
  assert.equal(snapshot.session.mode,'act');
  assert.equal(snapshot.session.agentId,'developer');
  assert.equal(snapshot.session.modelOverride,'current-model');
  assert.ok(snapshot.session.messages.some(message=>message.body==='Revise the plan'));
});

test('a plan pass returns the recorded full plan, not the readiness sentence', async () => {
  const task = new EngineeringTaskSession({...meta,mode:'plan'});
  task.bind({command:()=>{
    task.emit({type:'work_plan',planId:'revised',plan:{summary:'Fix the formatter',steps:[{action:'edit',target:'formatter.mjs',description:'Validate input and format duration'}]}});
    task.emit({type:'agent_event',event:{type:'agent_event',payload:{event:{type:'done',text:'Ready for your approval.',reason:'completed'}}}});
    task.emit({type:'ended',reason:'completed'});
  },close:()=>{},busy:false});
  const plan=await task.run('Revise',()=>false);assert.match(plan,/formatter.mjs/);assert.doesNotMatch(plan,/Ready for/);
});


test('human approval waits do not consume execution budget, including repeated reviews', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const task = new EngineeringTaskSession(meta); let busy=true; const commands:unknown[]=[];
  task.bind({command:value=>commands.push(value),close:()=>{},get busy(){return busy;}});
  const running=task.run('Implement',()=>false,1000);
  let outcome='running'; void running.then(()=>{outcome='completed';},()=>{outcome='failed';});
  for (const approvalId of ['edit','command']) {
    t.mock.timers.tick(200);
    task.emit({type:'approval',approvalId,category:'command',toolName:'run_commands',input:{}});
    t.mock.timers.tick(60_000); await Promise.resolve();
    assert.equal(outcome,'running'); assert.ok(!commands.some(value=>(value as {type:string}).type==='abort'));
    task.emit({type:'approval_resolved',approvalId,approved:true});
  }
  t.mock.timers.tick(200);
  task.emit({type:'agent_event',event:{type:'agent_event',payload:{event:{type:'done',text:'Implemented and tested.',reason:'completed'}}}});
  busy=false; task.emit({type:'ended',reason:'completed'});
  assert.equal(await running,'Implemented and tested.');
});

test('execution still times out after approval and stop remains available during review', async t => {
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  const task = new EngineeringTaskSession(meta); const commands:unknown[]=[];
  task.bind({command:value=>commands.push(value),close:()=>{},busy:true});
  const running=task.run('Implement',()=>false,1000);
  const rejected=assert.rejects(running,/exceeded its runtime budget/);
  t.mock.timers.tick(400);
  task.emit({type:'approval',approvalId:'edit',category:'edit',toolName:'apply_patch',input:{}});
  t.mock.timers.tick(60_000); await Promise.resolve();
  task.emit({type:'approval_resolved',approvalId:'edit',approved:false});
  t.mock.timers.tick(601); await rejected;
  assert.deepEqual(commands.at(-1),{type:'abort'});
  const stopped = new EngineeringTaskSession(meta); let stop=false;
  stopped.bind({command:value=>commands.push(value),close:()=>{},busy:true});
  const waiting=stopped.run('Implement',()=>stop);
  const cancelled=assert.rejects(waiting,/__stopped__/);
  stopped.emit({type:'approval',approvalId:'command',category:'command',toolName:'run_commands',input:{}});
  stop=true; t.mock.timers.tick(250); await cancelled;
  assert.deepEqual(commands.at(-1),{type:'abort'});
});
