import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringToolDecision, isEngineeringCommand, isEngineeringOpenMeta, type EngineeringControls } from '../engineering-protocol';

const controls: EngineeringControls = {
  mode: 'act',
  permissions: { read: true, edit: false, command: false, web: false, mcp: false },
  policy: { read: true, edit: true, command: true, web: true, mcp: true },
};

test('Engineering uses recommended controls and blocks unknown tools by default', () => {
  assert.equal(engineeringToolDecision(controls, 'read_files'), 'auto');
  assert.equal(engineeringToolDecision(controls, 'editor'), 'ask');
  assert.equal(engineeringToolDecision(controls, 'not_registered'), 'blocked');
  assert.equal(engineeringToolDecision(controls, 'github__get_issue'), 'ask');
});

test('Engineering Plan mode stays structurally read-only with stale auto permissions', () => {
  const plan = { ...controls, mode: 'plan' as const, permissions: { ...controls.permissions, edit: true, command: true } };
  assert.equal(engineeringToolDecision(plan, 'editor'), 'blocked');
  assert.equal(engineeringToolDecision(plan, 'run_commands'), 'blocked');
});

test('Engineering validates open and command payloads at the machine boundary', () => {
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', repoId: 'r1', repoName: 'app', branch: 'main' }), true);
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', repoId: 'r1', repoName: 'app', branch: 'main', modelId: 'gpt-5.5' }), true);
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', repoId: 'r1', repoName: 'app', branch: 'main', modelId: 'invented-client-model' }), false);
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', repoId: 'r1', repoName: 'app', branch: 'main', brainPack: 'openai-core' }), true);
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', projectId: 'p1', repoId: 'r1', repoName: 'app', branch: 'main' }), true);
  assert.equal(isEngineeringOpenMeta({ ...controls, threadId: 'e1', repoId: 'r1', repoName: 'app', branch: 'main', brainPack: '' }), false);
  assert.equal(isEngineeringOpenMeta({ ...controls, repoId: 'r1' }), false);
  assert.equal(isEngineeringCommand({ type: 'prompt', prompt: 'Fix it' }), true);
  assert.equal(isEngineeringCommand({ type: 'attachment_start', id: 'a1', name: 'spec.md', mime: 'text/markdown', size: 12 }), true);
  assert.equal(isEngineeringCommand({ type: 'attachment_chunk', id: 'a1', index: 0, data: 'aGVsbG8=' }), true);
  assert.equal(isEngineeringCommand({ type: 'attachment_end', id: 'a1' }), true);
  assert.equal(isEngineeringCommand({ type: 'prompt', prompt: 'Use it', attachments: [{ id: 'a1', name: 'spec.md', mime: 'text/markdown' }] }), true);
  assert.equal(isEngineeringCommand({ type: 'attachment_start', id: '../bad', name: 'spec.md', mime: 'text/markdown', size: 12 }), false);
  assert.equal(isEngineeringCommand({ type: 'attachment_chunk', id: 'a1', index: 0, data: 'x'.repeat(193 * 1024) }), false);
  assert.equal(isEngineeringCommand({ type: 'controls', controls }), true);
  assert.equal(isEngineeringCommand({ type: 'model', modelId: 'gpt-5.5' }), true);
  assert.equal(isEngineeringCommand({ type: 'model', modelId: null }), true);
  assert.equal(isEngineeringCommand({ type: 'model', modelId: 'invented-client-model' }), false);
  assert.equal(isEngineeringCommand({ type: 'brain', brainPack: 'openai-core' }), true);
  assert.equal(isEngineeringCommand({ type: 'brain', brainPack: null }), true);
  assert.equal(isEngineeringCommand({ type: 'brain', brainPack: '' }), false);
  assert.equal(isEngineeringCommand({ type: 'approval', approvalId: 'a1', approved: true }), true);
  assert.equal(isEngineeringCommand({ type: 'restore', checkpointRunCount: 2 }), true);
  assert.equal(isEngineeringCommand({ type: 'prompt', prompt: '' }), false);
});
