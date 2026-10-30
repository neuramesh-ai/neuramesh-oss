import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agyConversationStream } from './agy-stream';

test('Gemini conversation streams provider thinking, tool activity and reply across chunk boundaries', () => {
  const updates: Array<[string, string | undefined]> = [];
  const stream = agyConversationStream(['read_library_doc'], (text, thinking) => updates.push([text, thinking]));
  const frame = (step: Record<string, unknown>) => JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'turn', step_index: 1, step_type: 'agent_response', state: 'ACTIVE', ...step } }) + '\n';
  const thought = frame({ thinking_delta: 'Checking the project files.' });
  stream.push(thought.slice(0, 20)); stream.push(thought.slice(20));
  assert.deepEqual(updates.at(-1), ['', 'Checking the project files.']);
  stream.push(frame({ step_index: 2, step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { parameters: { ServerName: 'nm', ToolName: 'read_library_doc', Arguments: { name: 'business-profile.md' } } } }));
  assert.match(updates.at(-1)![1]!, /business-profile.md/);
  stream.push(frame({ step_index: 3, text_delta: 'Here are ' }));
  stream.push(frame({ step_index: 3, text_delta: 'three drafts.' }));
  assert.equal(updates.at(-1)![0], 'Here are three drafts.');
  stream.push(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Here are three drafts.' } }));
  assert.equal(stream.finish(), 'Here are three drafts.');
});

test('an incomplete or failed Gemini stream cannot masquerade as a successful reply', () => {
  assert.throws(() => agyConversationStream([]).finish(), /without a completed response/);
  const stream = agyConversationStream([]);
  stream.push(JSON.stringify({ event: 'result', result: { status: 'ERROR', response: 'Provider unavailable' } }));
  assert.throws(() => stream.finish(), /Provider unavailable/);
});

test('a refused headless tool gives an actionable failure instead of silently abandoning the conversation', () => {
  const stream = agyConversationStream(['read_library_doc']);
  stream.push(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ display_name: 'RunCommand' }] } }));
  assert.throws(() => stream.finish(), /refused RunCommand.*nm MCP server/);
});

test('a closed live bubble does not lose the completed reply or its recording', () => {
  const recorded: unknown[] = [];
  const stream = agyConversationStream([], () => { throw new Error('client disconnected'); }, event => recorded.push(event));
  stream.push(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Complete.' } }));
  assert.equal(stream.finish(), 'Complete.');
  assert.equal(recorded.length, 1);
});

test('complete public updates are recorded separately from reasoning and final output', () => {
  const messages: string[] = [];
  const stream = agyConversationStream(['list_library'], undefined, undefined, text => messages.push(text));
  const frame = (step: Record<string, unknown>) => JSON.stringify({event:'step_update',step_update:{conversation_id:'a',step_index:1,step_type:'agent_response',state:'ACTIVE',...step}})+'\n';
  stream.push(frame({thinking_delta:'private analysis'}));
  stream.push(frame({text_delta:'I’ll review '}));
  stream.push(frame({text_delta:'the project documents.',state:'DONE'}));
  stream.push(frame({step_index:2,step_type:'tool',tool_name:'list_library'}));
  stream.push(frame({step_index:3,text_delta:'The brief is clear.',state:'DONE'}));
  stream.push(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'The brief is clear.'}}));
  assert.equal(stream.finish(),'The brief is clear.');
  assert.deepEqual(messages,['I’ll review the project documents.','The brief is clear.']);
});

test('a cumulative Gemini result does not repeat progress and keeps earlier cards', () => {
  const stream = agyConversationStream(['list_library']);
  const progress = 'I’ll check the library.\n```nms\n["Review the brief"]\n```\n';
  const answer = 'The launch brief is ready.';
  for (const step of [
    {step_index:1,step_type:'agent_response',state:'DONE',text_delta:progress},
    {step_index:2,step_type:'tool',state:'ACTIVE',tool_name:'list_library'},
    {step_index:3,step_type:'agent_response',state:'DONE',text_delta:answer},
  ]) stream.push(JSON.stringify({event:'step_update',step_update:{conversation_id:'a',...step}})+'\n');
  stream.push(JSON.stringify({event:'result',result:{status:'SUCCESS',response:progress+answer}}));
  const result = stream.finish();
  assert.ok(result.includes(answer));
  assert.ok(result.includes('["Review the brief"]'));
  assert.ok(!result.includes('I’ll check the library.'));
});

test('malformed reasoning-as-text never streams, becomes public progress or a final reply', () => {
  const visible: string[] = [], messages: string[] = [];
  const stream = agyConversationStream([], text => visible.push(text), undefined, text => messages.push(text));
  for (const [index, text_delta] of ['th', 'ought\n', 'internal reasoning'].entries()) stream.push(JSON.stringify({event:'step_update',step_update:{conversation_id:'a',step_index:1,step_type:'agent_response',state:index===2?'DONE':'ACTIVE',text_delta}})+'\n');
  stream.push(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'thought\ninternal reasoning'}}));
  assert.throws(() => stream.finish(), /incorrectly formatted response/);
  assert.deepEqual(messages, []);
  assert.ok(visible.every(text => text === ''));
});
