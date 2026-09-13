import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringHarnessModelStep, engineeringHarnessStreamDeltas } from './engineering-model';

const tools = ['read_files', 'apply_patch', 'run_commands'].map((name) => ({ function: { name } }));

test('deterministic Engineering model plans with a read before its final plan', () => {
  assert.deepEqual(
    engineeringHarnessModelStep({ messages: [{ role: 'user', content: 'HARNESS_PLAN inspect' }], tools }),
    {
      kind: 'tool',
      name: 'read_files',
      input: { files: [{ path: 'README.md' }, { path: 'src/greeting.mjs' }, { path: 'test/greeting.test.mjs' }] },
      reasoning: 'I’ll inspect the fixture repository before proposing a read-only plan.',
    },
  );
  const done = engineeringHarnessModelStep({
    messages: [
      { role: 'user', content: 'HARNESS_PLAN inspect' },
      { role: 'assistant', tool_calls: [{ id: 'r', function: { name: 'read_files' } }] },
      { role: 'tool', content: 'files' },
    ],
    tools,
  });
  assert.equal(done.kind, 'text');
  assert.match(done.kind === 'text' ? done.text : '', /No files were changed in Plan mode/);
});

test('deterministic Engineering model acts through edit, verification, and final summary', () => {
  const base = [{ role: 'user', content: 'HARNESS_ACT implement' }];
  const edit = engineeringHarnessModelStep({ messages: base, tools });
  assert.equal(edit.kind === 'tool' ? edit.name : '', 'apply_patch');
  const verify = engineeringHarnessModelStep({
    messages: [...base, { role: 'assistant', tool_calls: [{ id: 'e', function: { name: 'apply_patch' } }] }, { role: 'tool', content: 'done' }],
    tools,
  });
  assert.deepEqual(verify, {
    kind: 'tool',
    name: 'run_commands',
    input: { commands: ['node --test test/greeting.test.mjs'] },
    reasoning: 'The edit is in place; I’ll run the focused repository test now.',
  });
  const done = engineeringHarnessModelStep({
    messages: [...base,
      { role: 'assistant', tool_calls: [{ id: 'e', function: { name: 'apply_patch' } }] }, { role: 'tool', content: 'done' },
      { role: 'assistant', tool_calls: [{ id: 'c', function: { name: 'run_commands' } }] }, { role: 'tool', content: 'pass' },
    ],
    tools,
  });
  assert.equal(done.kind, 'text');
  assert.match(done.kind === 'text' ? done.text : '', /verified/);
});

test('deterministic Engineering model uses Cline editor when apply_patch is unavailable', () => {
  const editorTools = ['read_files', 'editor', 'run_commands'].map((name) => ({ function: { name } }));
  const edit = engineeringHarnessModelStep({
    messages: [{ role: 'user', content: 'HARNESS_ACT implement' }],
    tools: editorTools,
  });
  assert.deepEqual(edit, {
    kind: 'tool',
    name: 'editor',
    input: {
      path: 'src/greeting.mjs',
      old_text: "export const greeting = () => 'hello';",
      new_text: "export const greeting = () => 'hello engineering';",
    },
    reasoning: 'I’ll apply the fixture change through the repository editing tool.',
  });
  const verify = engineeringHarnessModelStep({
    messages: [
      { role: 'user', content: 'HARNESS_ACT implement' },
      { role: 'assistant', tool_calls: [{ id: 'e', function: { name: 'editor' } }] },
      { role: 'tool', content: 'done' },
    ],
    tools: editorTools,
  });
  assert.equal(verify.kind === 'tool' ? verify.name : '', 'run_commands');
});

test('deterministic Engineering model emits observable reasoning before incremental text', () => {
  const step = engineeringHarnessModelStep({ messages: [{ role: 'user', content: 'connection check' }], tools });
  assert.equal(step.kind, 'text');
  const deltas = engineeringHarnessStreamDeltas(step);
  const reasoningDeltas = deltas.filter((delta) => typeof delta['reasoning_content'] === 'string');
  const textDeltas = deltas.filter((delta) => typeof delta['content'] === 'string');

  assert.ok(reasoningDeltas.length > 1, 'reasoning should arrive across multiple observable frames');
  assert.ok(textDeltas.length > 1, 'answer text should arrive across multiple observable frames');
  assert.equal(reasoningDeltas.map((delta) => delta['reasoning_content']).join(''), step.kind === 'text' ? step.reasoning : '');
  assert.equal(textDeltas.map((delta) => delta['content']).join(''), step.kind === 'text' ? step.text : '');
  assert.ok(deltas.indexOf(reasoningDeltas.at(-1)!) < deltas.indexOf(textDeltas[0]!), 'reasoning must finish before answer text starts');
});

test('deterministic Engineering model streams reasoning before a tool call', () => {
  const step = engineeringHarnessModelStep({ messages: [{ role: 'user', content: 'HARNESS_PLAN inspect' }], tools });
  assert.equal(step.kind, 'tool');
  const deltas = engineeringHarnessStreamDeltas(step);
  const toolIndex = deltas.findIndex((delta) => Array.isArray(delta['tool_calls']));
  const reasoningIndices = deltas.flatMap((delta, index) => typeof delta['reasoning_content'] === 'string' ? [index] : []);

  assert.ok(reasoningIndices.length > 1, 'tool reasoning should arrive across multiple observable frames');
  assert.ok(toolIndex > reasoningIndices.at(-1)!, 'tool call must follow its reasoning stream');
});
