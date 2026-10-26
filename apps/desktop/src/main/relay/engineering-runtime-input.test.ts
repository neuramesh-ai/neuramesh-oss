import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringRuntimeInput, portableRuntimeMessages } from './engineering-runtime-input';

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
  assert.match(input.config?.systemPrompt ?? '', /selected repository root is "\/workspace\/repo"/);
  assert.match(input.config?.systemPrompt ?? '', /current editing tool is editor/);
});


test('a GPT to Haiku handoff retains edit receipts without replaying unavailable tool calls', () => {
  const original = [
    { role: 'assistant' as const, modelInfo: { provider: 'openai', id: 'gpt' }, content: [{ type: 'tool_use' as const, id: 'patch-1', name: 'apply_patch', input: { input: 'the original patch' } }] },
    { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'patch-1', name: 'apply_patch', content: 'saved src/ledger.mjs' }] },
  ];
  const replay = portableRuntimeMessages(original, 'anthropic', 'haiku');
  assert.ok(replay.every(message => Array.isArray(message.content) && message.content.every(block => block.type === 'text')));
  assert.match(JSON.stringify(replay), /the original patch/);
  assert.match(JSON.stringify(replay), /saved src\/ledger.mjs/);
  assert.deepEqual(portableRuntimeMessages(replay, 'anthropic', 'haiku'), replay);
  assert.equal(original[0]?.content[0]?.type, 'tool_use');
});


test('returning to a GPT transport keeps prior editor receipts as history', () => {
  const history = [
    { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 'edit-1', name: 'editor', input: { command: 'str_replace', path: 'src/ledger.mjs' } }] },
    { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'edit-1', name: 'editor', content: 'saved' }] },
  ];
  for (const provider of ['openai-native', 'openai-codex']) {
    const replay = portableRuntimeMessages(history, provider, 'gpt');
    assert.ok(replay.every(message => Array.isArray(message.content) && message.content.every(block => block.type === 'text')));
    assert.match(JSON.stringify(replay), /src\/ledger.mjs/);
    assert.match(JSON.stringify(replay), /saved/);
  }
});
