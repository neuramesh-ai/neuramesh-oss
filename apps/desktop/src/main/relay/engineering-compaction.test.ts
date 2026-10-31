import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClineCore } from '@cline/sdk';
import { compactEngineeringMessages, portableEngineeringCompaction, projectedEngineeringMessages } from './engineering-compaction';
import { portableRuntimeMessages } from './engineering-runtime-input';

type Messages = Awaited<ReturnType<ClineCore['readMessages']>>;
const journal = (): Messages => Array.from({ length: 8 }, (_, i) => [
  { role: 'user', content: [{ type: 'text', text: `Request ${i}: keep task #42 and never publish without approval.` }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: `call-${i}`, name: 'read_file', input: { path: 'src/index.ts' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: `call-${i}`, content: 'Large file detail. '.repeat(15000) }] },
  { role: 'assistant', content: [{ type: 'text', text: `Result ${i}: tests passed; implementation remains unmerged.` }] },
]).flat() as Messages;

test('native compaction keeps canonical history and user constraints while reducing tool-heavy input', async () => {
  const messages = journal(), before = JSON.stringify(messages);
  const state = await compactEngineeringMessages(messages, undefined, 'openai', 'gpt-5.6-sol', 'test-thread');
  assert.ok(state);
  const projected = await projectedEngineeringMessages(messages, state);
  assert.ok(JSON.stringify(projected).length < before.length / 2);
  for (let i = 0; i < 8; i++) assert.match(JSON.stringify(projected), new RegExp(`Request ${i}: keep task #42`));
  assert.equal(JSON.stringify(messages), before);
  const continued: Messages = [...messages, { role: 'user', content: [{ type: 'text', text: 'Continue with the same restrictions.' }] }];
  assert.match(JSON.stringify(await projectedEngineeringMessages(continued, state)), /Continue with the same restrictions/);
  assert.deepEqual(await projectedEngineeringMessages(messages.slice(4), state), messages.slice(4));
});

test('provider handoff revalidates compaction against the normalized journal and rejects stale prefixes', async () => {
  const messages = journal();
  const state = await compactEngineeringMessages(messages, undefined, 'openai', 'gpt-5.6-sol', 'test-thread');
  const next = await portableEngineeringCompaction(messages, state, 'anthropic', 'claude-haiku-4-5');
  assert.ok(next);
  const portable = portableRuntimeMessages(messages, 'anthropic', 'claude-haiku-4-5');
  assert.ok(JSON.stringify(await projectedEngineeringMessages(portable, next)).length < JSON.stringify(portable).length / 2);
  assert.equal(await portableEngineeringCompaction(messages.slice(1), state, 'anthropic', 'claude-haiku-4-5'), undefined);
});
