import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from './oracle.mjs';

function evidence() {
  const homes = ['lead','research','design'].map(seat => ({ seat, id:seat, agentId:`agent-${seat}` }));
  const messages = homes.map(h => ({ thread_id:h.id, author_id:h.agentId, author_kind:'agent', body:`pilot-${h.seat}-READY`, created_at:'2026-01-01T00:00:02Z' }));
  for (const peer of homes.slice(1)) {
    messages.push({ thread_id:peer.id, author_id:'agent-lead', author_kind:'agent', team_source_thread_id:'lead', team_depth:1, body:'Review', created_at:'2026-01-01T00:00:04Z' });
    messages.push({ thread_id:'lead', author_id:peer.agentId, author_kind:'agent', team_source_thread_id:peer.id, team_depth:2, body:`pilot-${peer.seat}-SIGNOFF`, created_at:'2026-01-01T00:00:06Z' });
  }
  messages.push({ thread_id:'lead',author_id:'agent-lead',body:'‹article:doc›' });
  return { marker:'pilot', projectId:'project', otherProjectMarker:'private-canary', homes, messages,
    toolReceipts:[{threadId:'lead',name:'list_team',ok:true},...homes.slice(1).map(h=>({threadId:'lead',name:'read_agent_thread',input:{threadId:h.id},ok:true}))],
    runs:homes.map(h => ({thread_id:h.id,agent_id:h.agentId,state:'done',started_at:'2026-01-01T00:00:00Z',ended_at:'2026-01-01T00:00:03Z'})),
    artifacts:[{id:'doc',created_by:'agent-lead',project_id:'project',created_at:'2026-01-01T00:00:08Z',inline_content:'pilot 37 4800 4.5:1 14 pilot-research-SIGNOFF pilot-design-SIGNOFF'}] };
}
test('accepts independently persisted overlapping work and a combined delivery',()=>assert.equal(grade(evidence()).passed,true));
test('rejects an assistant claiming collaboration without actual handoff rows or read receipts',()=>{const e=evidence();e.messages=e.messages.filter(m=>!m.team_source_thread_id);assert.equal(grade(e).passed,false);const f=evidence();f.toolReceipts=[];assert.equal(grade(f).passed,false);});
test('rejects impersonated or out-of-order returned contributions',()=>{for(const field of ['author_id','created_at']){const e=evidence();e.messages.find(m=>m.team_depth===2)[field]=field==='author_id'?'agent-lead':'2025-01-01T00:00:00Z';assert.equal(grade(e).passed,false);}});
test('rejects sequential work, premature delivery, missing constraints and foreign artifacts',()=>{
  for(const mutate of [e=>e.runs.forEach((r,i)=>{r.started_at=new Date(Date.UTC(2026,0,1,0,0,i*10)).toISOString();r.ended_at=new Date(Date.UTC(2026,0,1,0,0,i*10+3)).toISOString();}),e=>e.artifacts[0].created_at='2026-01-01T00:00:01Z',e=>e.artifacts[0].inline_content='pilot done',e=>e.artifacts[0].project_id='other',e=>e.runs[0].state='failed',e=>e.artifacts[0].inline_content+=' private-canary']){const e=evidence();mutate(e);assert.equal(grade(e).passed,false);}
});
