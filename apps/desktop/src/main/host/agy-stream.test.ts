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
