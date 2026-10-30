import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { hostConversationRecorder } from './brain-recording';
import { recordConversationEvent } from '../harness/brain-sync';
import { recordRuntimeEvent } from '../runtime/brain-recording';
import type { BrainConversationEvent } from '@neuramesh/shared';

test('concurrent generic turns share one hydrated writer and retain both complete outputs', async () => {
  const root = mkdtempSync('/tmp/nm-generic-writer-');
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => { release = resolve; });
  let gets = 0; let revision = 0;
  const events: BrainConversationEvent[] = [];
  const around = hostConversationRecorder({ root, workspace: 'workspace-a', actorId: 'actor-a', apiUrl: 'https://api.test', headers: async () => ({}), intervalMs: 60_000, db: { getAll: async () => [] }, fetchImpl: async (_url, init) => {
    if (init?.method !== 'POST') { gets++; await loaded; return new Response('', { status: 404 }); }
    const request = JSON.parse(String(init.body));
    assert.equal(request.expectedRevision, revision);
    events.push(...request.events);
    return new Response(JSON.stringify({ ok: true, commitId: request.commitId, revision: ++revision }));
  } });
  const work = (key: string) => ({ key, kind: 'chat' as const, cause: 'board' as const, agentId: key, subject: { kind: 'thread' as const, id: 'same-thread' } });
  try {
    const first = around(work('a'), async () => { recordConversationEvent('assistant.message', { text: 'First complete answer' }); });
    const second = around(work('b'), async () => { recordConversationEvent('assistant.message', { text: 'Second complete answer' }); });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(gets, 1);
    release(); await Promise.all([first, second]);
    assert.deepEqual(events.filter((event) => event.type === 'assistant.message').map((event) => (event.payload as { text: string }).text).sort(), ['First complete answer', 'Second complete answer']);
    assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  } finally { release(); rmSync(root, { recursive: true, force: true }); }
});

test('interleaved tool calls retain their own turn attribution', async () => {
  const { withConversationBrain, captureConversationRecorder } = await import('../harness/brain-sync');
  const events: Array<{type:string;payload:any}> = [];
  const brain = { record(type:string,payload:unknown){ events.push({type,payload}); } } as any;
  let finish!:()=>void;
  const wait=new Promise<void>(resolve=>finish=resolve);
  const first=withConversationBrain(brain,async()=>{
    const record=captureConversationRecorder();record('tool.call',{id:'a',name:'read_repo_file'});
    await wait;record('tool.result',{id:'a',output:'first'});
  },'turn-a');
  await withConversationBrain(brain,async()=>{recordConversationEvent('tool.call',{id:'b',name:'list_repos'});},'turn-b');
  finish();await first;
  assert.deepEqual(events.map(e=>[e.payload.id,e.payload.turnId]),[['a','turn-a'],['b','turn-b'],['a','turn-a']]);
});

test('only the parent assistant public text becomes attributed conversation progress', async () => {
  const { withConversationBrain } = await import('../harness/brain-sync');
  const events: Array<{type:string;payload:any}> = [];
  const brain = { record(type:string,payload:unknown){ events.push({type,payload}); } } as any;
  await withConversationBrain(brain, async () => {
    recordRuntimeEvent('claude', {type:'user',message:{content:[{type:'text',text:'User input'}]}});
    recordRuntimeEvent('claude', {type:'assistant',parent_tool_use_id:'child',message:{content:[{type:'text',text:'Child agent output'}]}});
    recordRuntimeEvent('claude', {type:'assistant',message:{content:[{type:'thinking',thinking:'Private'},{type:'text',text:'I found the launch brief.'}]}});
  }, 'parent');
  assert.deepEqual(events.filter(e=>e.type==='assistant.message').map(e=>e.payload),[{text:'I found the launch brief.',turnId:'parent'}]);
  assert.equal(events.filter(e=>e.type==='runtime.event').length,3);
});
