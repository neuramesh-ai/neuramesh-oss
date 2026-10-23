import test from 'node:test';
import assert from 'node:assert/strict';
import { AgyEventMapper } from './engineering-agy-events';
import { agyArgs, agyModeFor, agyModelFor, agyUserLine, nmToolCall, nmToolsMissed } from './engineering-agy-args';

const ours = new Set(['run_commands', 'editor', 'apply_patch', 'propose_work_plan', 'show_artifact']);
const conv = 'e6d48bc4-d483-4d1f-a609-83d596e4f650';
// the shapes agy 1.4.0 printed on 2026-10-16 (paths replaced)
const init = { event: 'init', conversation_id: conv, init: { model: 'gemini-3.8-flash-low', cwd: '/work/repo', tools: ['view_file', 'write_to_file', 'run_command', 'call_mcp_tool'], permission_mode: 'request-review' } };
const step = (index: number, state: string, extra: Record<string, unknown>) => ({ event: 'step_update', step_update: { conversation_id: conv, step_index: index, state, ...extra } });
const inner = (e: { type: string; event?: Record<string, unknown> }) => ((e.event?.['payload'] as Record<string, unknown>)?.['event'] ?? {}) as Record<string, unknown>;

test('a text turn streams deltas, ends with the whole text, and closes the turn as completed', () => {
  const mapper = new AgyEventMapper(ours, () => 1000);
  const first = mapper.map(init);
  assert.deepEqual(first.init, { conversationId: conv, model: 'gemini-3.8-flash-low', tools: init.init.tools, permissionMode: 'request-review' });
  assert.deepEqual(mapper.map(step(0, 'DONE', { step_type: 'user_input' })).events, []);
  const delta = mapper.map(step(1, 'ACTIVE', { step_type: 'agent_response', text_delta: 'OK' })).events.map(inner);
  assert.deepEqual(delta, [{ type: 'content_start', contentType: 'text', text: 'OK', accumulated: 'OK' }]);
  const end = mapper.map(step(1, 'DONE', { step_type: 'agent_response', text_delta: '\n', usage: { input_tokens: 16169, output_tokens: 1 } })).events.map(inner);
  assert.deepEqual(end.at(-1), { type: 'content_end', contentType: 'text', text: 'OK\n' });
  const result = mapper.map({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: 'OK\n', usage: { input_tokens: 16169, output_tokens: 1, total_tokens: 16170 } } });
  assert.deepEqual(result.events.map(inner), [{ type: 'done', reason: 'completed' }]);
  assert.equal(result.result?.ok, true);
  assert.equal(result.result?.inputTokens, 16169);
  assert.equal(result.result?.outputTokens, 1);
});

test('tool steps keep one call id, map NeuraMesh MCP names back, flag edits and name refusals', () => {
  let clock = 0;
  const mapper = new AgyEventMapper(ours, () => clock);
  const write = mapper.map(step(2, 'ACTIVE', { step_type: 'tool', tool_name: 'write_to_file', tool_info: { name: 'write_to_file', parameters: { TargetFile: '/work/repo/probe.txt' } } }));
  assert.equal(inner(write.events[0]!)['toolName'], 'write_to_file');
  assert.deepEqual(mapper.map(step(2, 'ACTIVE', { step_type: 'tool', tool_name: 'write_to_file' })).events, [], 'a repeated ACTIVE adds no second row');
  clock = 40;
  const wrote = mapper.map(step(2, 'DONE', { step_type: 'tool', tool_name: 'write_to_file' }));
  assert.equal(wrote.edited, true);
  assert.deepEqual(inner(wrote.events[0]!), { type: 'content_end', contentType: 'tool', toolName: 'write_to_file', toolCallId: `agy-${conv}:2`, durationMs: 40 });
  // agy 1.4.0 calls an MCP tool through call_mcp_tool: the row wears the NeuraMesh tool's name and its own input
  const nm = mapper.map(step(3, 'ACTIVE', { step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'nm', ToolName: 'run_commands', Arguments: { commands: ['npm test'] } } } }));
  assert.equal(inner(nm.events[0]!)['toolName'], 'run_commands');
  assert.deepEqual(inner(nm.events[0]!)['input'], { commands: ['npm test'] });
  const nmDone = mapper.map(step(3, 'DONE', { step_type: 'tool', tool_name: 'call_mcp_tool' }));
  assert.equal(inner(nmDone.events[0]!)['toolName'], 'run_commands', 'the end row keeps the name the start row had');
  const other = mapper.map(step(5, 'ACTIVE', { step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: { parameters: { ServerName: 'chrome-devtools', ToolName: 'take_screenshot', Arguments: {} } } }));
  assert.equal(inner(other.events[0]!)['toolName'], 'call_mcp_tool', 'another server keeps agy\'s own name');
  const refused = mapper.map(step(4, 'ERROR', { step_type: 'tool', tool_name: 'run_command' }));
  assert.equal(refused.edited, false);
  assert.match(String((inner(refused.events[0]!)['error'] as Record<string, unknown>)['message']), /did not run/);
  const result = mapper.map({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } });
  assert.deepEqual(result.result?.denied, ['RunCommand']);
  assert.equal(inner(result.events[0]!)['type'], 'notice');
  assert.equal(inner(result.events.at(-1)!)['reason'], 'completed');
});

test('a failed run closes as an error, and unknown lines map to nothing', () => {
  const mapper = new AgyEventMapper(ours);
  assert.deepEqual(mapper.map({ event: 'step_update', step_update: { step_type: 'planner_note', state: 'DONE' } }).events, []);
  assert.deepEqual(mapper.map('not json').events, []);
  const failed = mapper.map({ event: 'result', result: { conversation_id: conv, status: 'ERROR', response: '' } });
  assert.equal(failed.result?.ok, false);
  assert.equal(inner(failed.events.at(-1)!)['reason'], 'error');
});

test('a NeuraMesh pick maps onto agy model ids, and a level agy lacks takes the next one up', () => {
  assert.equal(agyModelFor('gemini-4-argon', 'high'), 'gemini-4-argon-high');
  assert.equal(agyModelFor('gemini-3.8-flash', 'low'), 'gemini-3.8-flash-low');
  assert.equal(agyModelFor('gemini-3.1-pro-preview', 'medium'), 'gemini-3.1-pro-high');
  assert.match(agyModelFor('gemini-4-argon', null) ?? '', /^gemini-4-argon-(low|medium|high)$/);
  assert.equal(agyModelFor('gemini-3.1-flash-lite', 'low'), null);
  assert.equal(agyModelFor('claude-sonnet-5-5', 'high'), null);
});

test('Plan keeps agy\'s default mode, edits that run by themselves map to accept-edits, and argv ends with -p=', () => {
  const controls = (mode: 'plan' | 'act', edit: boolean, policy = true) => ({ mode, permissions: { read: true, edit, command: true, web: true, mcp: true }, policy: { read: true, edit: policy, command: true, web: true, mcp: true } });
  // headless agy's default mode refuses its own writes and commands, and the nm gate blocks them in Plan
  assert.equal(agyModeFor(controls('plan', true)), null);
  assert.equal(agyModeFor(controls('act', true)), 'accept-edits');
  assert.equal(agyModeFor(controls('act', false)), null);
  assert.equal(agyModeFor(controls('act', true, false)), null);
  const argv = agyArgs({ model: 'gemini-4-argon-high', mode: 'accept-edits', conversationId: conv, addDirs: ['/tmp/att'] });
  assert.deepEqual(argv, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'gemini-4-argon-high', '--mode', 'accept-edits', '--conversation', conv, '--add-dir', '/tmp/att', '-p=']);
  assert.deepEqual(agyArgs({ model: null, mode: null }), ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p=']);
  assert.deepEqual(JSON.parse(agyUserLine('hi')), { event: 'user', message: { role: 'user', content: 'hi' } });
});

test('a NeuraMesh tool is found behind call_mcp_tool, and a refused command means the tools did not reach the model', () => {
  assert.deepEqual(nmToolCall('call_mcp_tool', { ServerName: 'nm', ToolName: 'editor', Arguments: { path: 'a.ts' } }, ours), { toolName: 'editor', input: { path: 'a.ts' } });
  assert.equal(nmToolCall('call_mcp_tool', { ServerName: 'nm', ToolName: 'not_ours', Arguments: {} }, ours), null);
  assert.equal(nmToolCall('call_mcp_tool', { ServerName: 'github', ToolName: 'editor' }, ours), null);
  assert.deepEqual(nmToolCall('show_artifact', { path: 'x.md' }, ours), { toolName: 'show_artifact', input: { path: 'x.md' } });
  assert.equal(nmToolCall('view_file', {}, ours), null);
  // the denied actions agy printed: display names (RunCommand) or actions (command, mcp)
  assert.equal(nmToolsMissed(['RunCommand']), true);
  assert.equal(nmToolsMissed(['mcp']), true);
  assert.equal(nmToolsMissed(['CallMcpTool']), true);
  assert.equal(nmToolsMissed(['WriteToFile']), false);
  assert.equal(nmToolsMissed([]), false);
});
