import { test, expect } from 'vitest';
import { createEngineeringSession } from '../src/engineering/domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt } from '../src/engineering/remote';
import { engineeringActivityPresentation } from '../src/engineering/activity';
import { persistableEngineeringSession } from '../src/engineering/copy';
import { toolDisplayInput, toolDisplayOutput } from '../src/engineering/tool-receipts';
import { failRemoteEngineeringTransport } from '../src/engineering/transport-state';

const wire = (type: string, toolCallId: string, toolName: string, extra = {}) => ({ type: 'agent_event', event: { type: 'agent_event', payload: { event: { type, contentType: 'tool', toolCallId, toolName, ...extra } } } });
const fresh = () => beginRemoteEngineeringPrompt(createEngineeringSession({ id: 'repo', name: 'fixture', owner: 'local', branch: 'main', root: null }), 'Inspect this repository.');

test('interleaved calls retain their inputs and complete in place without duplicate receipts', () => {
  let s = fresh();
  s = applyRemoteEngineeringEvent(s, wire('content_start', 'a', 'read_file', { input: { file_path: 'README.md' } }));
  s = applyRemoteEngineeringEvent(s, wire('content_start', 'b', 'run_commands', { input: { commands: ['npm test'] } }));
  s = applyRemoteEngineeringEvent(s, wire('content_end', 'b', 'run_commands', { output: { stdout: '5 tests passed' }, durationMs: 400 }));
  s = applyRemoteEngineeringEvent(s, wire('content_end', 'b', 'run_commands', { durationMs: 400 }));
  s = applyRemoteEngineeringEvent(s, wire('content_end', 'a', 'read_file', { durationMs: 50 }));
  s = applyRemoteEngineeringEvent(s, wire('content_end', 'a', 'read_file', { durationMs: 50 }));
  const tools = s.messages.filter(m => m.tool);
  expect(tools).toHaveLength(2);
  expect(tools[0]?.tool).toMatchObject({ name: 'read_file', input: { file_path: 'README.md' }, state: 'succeeded' });
  expect(tools[1]?.tool).toMatchObject({ input: { commands: ['npm test'] }, output: '5 tests passed', durationMs: 400 });
  expect(engineeringActivityPresentation(tools[0]!).kind).toBe('read');
  expect(persistableEngineeringSession(s).messages.filter(m => m.tool)).toHaveLength(2);
});

test('a lost connection stops running receipts without pretending they succeeded', () => {
  const s = applyRemoteEngineeringEvent(fresh(), wire('content_start', 'a', 'run_commands', { input: { commands: ['npm test'] } }));
  const failed = failRemoteEngineeringTransport(s, 'Connection closed');
  expect(failed.messages.find(m => m.tool)?.tool?.state).toBe('interrupted');
  expect(failed.state).toBe('resumable');
});

test('legacy sequential tool events without call IDs remain separate actions', () => {
  let s = fresh();
  for (const path of ['a.md', 'b.md']) {
    s = applyRemoteEngineeringEvent(s, wire('content_start', '', 'read_files', { input: { paths: [path] } }));
    s = applyRemoteEngineeringEvent(s, wire('content_end', '', 'read_files'));
  }
  expect(s.messages.filter(m => m.tool).map(m => m.tool?.input)).toEqual([{ paths: ['a.md'] }, { paths: ['b.md'] }]);
});

test('failed and unfinished actions retain honest outcomes across a stop and local persistence', () => {
  let s = applyRemoteEngineeringEvent(fresh(), wire('content_start', 'a', 'view_image', { input: { path: 'cover.png' } }));
  s = applyRemoteEngineeringEvent(s, wire('content_start', 'b', 'run_commands', { input: { commands: ['npm test'] } }));
  s = applyRemoteEngineeringEvent(s, wire('content_end', 'b', 'run_commands', { error: { message: 'Process exited with code 1' } }));
  s = applyRemoteEngineeringEvent(s, { type: 'ended', reason: 'aborted' });
  expect(s.messages.filter(m => m.tool).map(m => m.tool?.state)).toEqual(['interrupted', 'failed']);
  expect(s.messages.at(-1)?.tool?.error).toBe('Process exited with code 1');
  expect(engineeringActivityPresentation(s.messages.find(m => m.tool?.name === 'view_image')!).kind).toBe('image');
  expect(persistableEngineeringSession(s).messages.filter(m => m.tool).map(m => m.tool?.state)).toEqual(['interrupted', 'failed']);
});

test('successful output that mentions errors is not mislabelled as failure', () => {
  const s = applyRemoteEngineeringEvent(fresh(), wire('content_end', 'a', 'run_commands', { output: 'No errors found' }));
  expect(engineeringActivityPresentation(s.messages.at(-1)!).status).toBe('success');
});

test('display payloads exclude binary data and credential fields and remain bounded', () => {
  expect(toolDisplayInput({ path: 'image.png', apiKey: 'private', nested: { token: 'private' }, data: 'binary' })).toEqual({ path: 'image.png', apiKey: '[redacted]', nested: { token: '[redacted]' }, data: '[redacted]' });
  expect(toolDisplayOutput({ content: [{ type: 'image', data: 'binary' }, { type: 'text', text: 'Image viewed' }], providerMetadata: 'private' })).toBe('Image viewed');
  expect(toolDisplayOutput({ apiKey: 'private' })).toBeUndefined();
  expect(toolDisplayOutput('x'.repeat(100_000))!.length).toBeLessThan(17_000);
});
