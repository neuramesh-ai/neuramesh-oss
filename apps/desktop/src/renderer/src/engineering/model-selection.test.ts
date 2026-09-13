import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_MODEL, type CustomModelPack } from '@neuramesh/shared';
import { preferredDeveloperSeat, projectDeveloperModel } from './model-selection';

const agent = (name: string, model: string, modelSource = 'pack') => ({
  name, model, model_source: modelSource, role: 'developer', kind: 'local', retired_at: null,
});

test('Code displays the same preferred developer seat the machine resolves', () => {
  const picked = preferredDeveloperSeat([
    agent('another-developer', 'claude-sonnet-5', 'manual'),
    agent('patch', 'claude-opus-4-8'),
    { ...agent('remote-patch', 'gpt-5.5'), kind: 'remote' },
  ]);
  assert.equal(picked?.name, 'patch');
  assert.equal(projectDeveloperModel(null, null, [picked!], []), 'claude-opus-4-8');
});

test('Code resolves project and custom developer models before a thread opens', () => {
  const custom = [{
    id: 'custom:code', name: 'Code team', updatedAt: '',
    roles: { developer: 'gpt-5.5' },
  } as unknown as CustomModelPack];
  assert.equal(projectDeveloperModel(null, 'custom:code', [agent('patch', 'claude-opus-4-8')], custom), 'gpt-5.5');
  assert.equal(projectDeveloperModel('claude-sonnet-5', 'custom:code', [], custom), 'claude-sonnet-5');
  assert.equal(projectDeveloperModel(null, null, [], []), STARTER_MODEL);
});
