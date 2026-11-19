import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClineCore, CoreSessionEvent } from '@cline/sdk';
import { getFollowupTarget } from '../host/thread-followups';
import { CodingFollowups } from './engineering-followups';

test('a steer is delivered only on a matching Cline consumption receipt, and cannot approve a pending edit', async () => {
  const handler=new CodingFollowups(), received:string[]=[], inputs:unknown[]=[];
  let declined=0;
  const core={send: async (input:unknown) => { inputs.push(input); }} as unknown as ClineCore;
  handler.listen('thread',{
    core:()=>core, session:()=>'current', mode:()=>'act', busy:()=>true, refuse:()=>null,
    resolveFiles:async()=>({userImages:[],userFiles:[]}),releaseFiles:()=>{},start:async()=>{throw new Error('second session');},
    interruptApproval:()=>{declined++;},received:(id,text)=>{received.push(id+':'+text);},
  });
  const deliver=getFollowupTarget('thread')!.apply('Inspect the other file','id',true,[]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(declined,1);assert.deepEqual(received,[]);
  const receipt=(sessionId:string,prompt:string)=>({type:'pending_prompt_submitted',payload:{sessionId,prompt,delivery:'steer',id:'native',attachmentCount:0}} as CoreSessionEvent);
  handler.observe(receipt('other','Inspect the other file'));
  handler.observe(receipt('current','Unrelated'));
  assert.deepEqual(received,[]);
  handler.observe(receipt('current','Inspect the other file'));
  assert.equal(await deliver,true);
  assert.deepEqual(received,['id:Inspect the other file']);
  assert.equal(inputs.length,1);
  const interrupted=getFollowupTarget('thread')!.apply('An interrupted message','id2',true,[]);
  await new Promise(resolve=>setImmediate(resolve));
  handler.close();await assert.rejects(interrupted,/closed before it confirmed/);
  assert.equal(getFollowupTarget('thread'),undefined);
});
