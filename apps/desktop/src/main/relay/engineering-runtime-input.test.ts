import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringRuntimeInput } from './engineering-runtime-input';

const controls = {
  mode: 'act' as const,
  permissions: { read: true, edit: true, command: true, web: true, mcp: true },
  policy: { read: true, edit: true, command: true, web: true, mcp: true },
};

test('Code sessions disable every repository-owned runtime extension', () => {
  const input = engineeringRuntimeInput({
    meta: {
      threadId: 'thread-1', repoId: 'repo-1', repoName: 'repo', branch: 'main', actorId: 'actor-1',
      ...controls,
    },
    cwd: '/workspace/repo',
    provider: { providerId: 'anthropic', modelId: 'claude-sonnet-5', apiKey: 'test-only' },
    modelId: null,
    brainPack: null,
    controls,
  });

  assert.deepEqual(input.localRuntime?.configExtensions, []);
});
