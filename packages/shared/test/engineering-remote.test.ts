import { test } from 'vitest';
import assert from 'node:assert/strict';
import { STARTER_MODEL } from '../src/rates';
import { createEngineeringSession } from '../src/engineering/domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, resolveRemoteEngineeringApproval } from '../src/engineering/remote';
import { failRemoteEngineeringTransport } from '../src/engineering/transport-state';

const repo = { id: 'r1', name: 'app', owner: 'acme', branch: 'main', root: null };

test('remote Cline events preserve complete edit proposals until approval and tool completion', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Fix the callback');
  assert.equal(session.activeActivity?.phase, 'thinking');
  session = applyRemoteEngineeringEvent(session, {
    type: 'agent_event', event: { type: 'agent_event', payload: { event: {
      type: 'content_start', contentType: 'tool', toolCallId: 'a1', toolName: 'editor', input: { path: 'src/auth.ts', old_text: 'old()', new_text: 'fixed()' },
    } } },
  });
  assert.deepEqual({ phase: session.activeActivity?.phase, toolName: session.activeActivity?.toolName }, { phase: 'tool', toolName: 'editor' });
  session = applyRemoteEngineeringEvent(session, {
    type: 'approval', approvalId: 'a1', category: 'edit', toolName: 'editor',
    input: { path: 'src/auth.ts', old_text: 'old()', new_text: 'fixed()' },
  });
  assert.equal(session.state, 'awaiting_approval');
  assert.equal(session.activeActivity, null);
  assert.match(session.pendingApproval?.changes?.[0]?.diff ?? '', /fixed/);
  session = resolveRemoteEngineeringApproval(session, true);
  assert.equal(session.activeActivity?.phase, 'thinking');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'tool', toolCallId: 'a1', toolName: 'editor', output: { success: true },
  } } } });
  assert.equal(session.changes[0]?.path, 'src/auth.ts');
  assert.equal(session.proposedChanges.length, 0);
  assert.equal(session.activeActivity?.phase, 'thinking');
});

test('auto-approved edits still surface diffs and failed tools never look applied', () => {
  let session = createEngineeringSession(repo);
  const started = { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_start', contentType: 'tool', toolCallId: 'a1', toolName: 'editor', input: { path: 'src/auth.ts', old_text: 'old()', new_text: 'fixed()' },
  } } } };
  session = applyRemoteEngineeringEvent(session, started);
  assert.equal(session.proposedChanges[0]?.path, 'src/auth.ts');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'tool', toolCallId: 'a1', toolName: 'editor', error: 'disk full',
  } } } });
  assert.equal(session.changes.length, 0);
  assert.equal(session.proposedChanges.length, 0);
  assert.match(session.messages.at(-1)?.body ?? '', /failed/);
});

test('web approval shows the destination URL before consent', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'approval', approvalId: 'web-1', category: 'web', toolName: 'fetch_web_content',
    input: { url: 'https://docs.example.com/api', prompt: 'Read the API docs' },
  });
  assert.match(session.pendingApproval?.command ?? '', /https:\/\/docs\.example\.com\/api/);
});

test('sequential Cline edits accumulate a complete multi-file change set', () => {
  let session = createEngineeringSession(repo);
  for (const [path, after] of [['src/one.ts', 'one()'], ['src/two.ts', 'two()']] as const) {
    session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
      type: 'content_start', contentType: 'tool', toolName: 'editor', input: { path, old_text: '', new_text: after },
    } } } });
    session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
      type: 'content_end', contentType: 'tool', toolName: 'editor', output: { success: true },
    } } } });
  }
  assert.deepEqual(session.changes.map((change) => change.path), ['src/one.ts', 'src/two.ts']);
});

test('apply_patch rename destinations appear in the approval change list', () => {
  const patch = '*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch';
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'approval', approvalId: 'move-1', category: 'edit', toolName: 'apply_patch', input: { input: patch },
  });
  assert.deepEqual(session.pendingApproval?.changes?.map((change) => change.path), ['src/old.ts', 'src/new.ts']);
});

test('ready and restore events retain actual model and checkpoint file state', () => {
  let session = createEngineeringSession(repo);
  session = applyRemoteEngineeringEvent(session, { type: 'ready', provider: 'openai-native', model: 'gpt-5.4', modelId: null, brainPack: null, cwd: '/repo' });
  assert.equal(session.provider, 'openai-native');
  assert.equal(session.model, 'gpt-5.4');
  const change = { path: 'src/one.ts', kind: 'modified' as const, before: 'old', after: 'new', diff: '-old\n+new' };
  session = {
    ...session,
    changes: [],
    workPlan: 'later',
    messages: [...session.messages, { ...session.messages[0]!, id: 'post-checkpoint', body: 'This must be forgotten after restore.' }],
    checkpoints: [{ id: 'cline-run-2', label: 'Before turn', createdAt: new Date().toISOString(), messageCount: 1, changes: [change], workPlan: 'checkpoint plan' }],
  };
  session = applyRemoteEngineeringEvent(session, { type: 'restored', checkpointRunCount: 2 });
  assert.deepEqual(session.changes, [change]);
  assert.equal(session.workPlan, 'checkpoint plan');
  assert.equal(session.messages.some((item) => item.id === 'post-checkpoint'), false);
  assert.match(session.messages.at(-1)?.body ?? '', /Restored checkpoint/);
});

test('the managed starter keeps its backing model id out of Code transcript copy', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'ready', provider: 'neuramesh-metered', model: STARTER_MODEL, modelId: null, brainPack: null, cwd: '/repo',
  });
  assert.equal(session.model, STARTER_MODEL, 'runtime state retains the machine-readable model id');
  assert.equal(session.messages.length, 1, 'routine runtime readiness does not become transcript activity');
  assert.doesNotMatch(JSON.stringify(session.messages), new RegExp(STARTER_MODEL));
});

test('a confirmed model switch updates the task override and effective Code model', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'model_changed', modelId: 'gpt-5.5', brainPack: null, provider: 'openai-native', model: 'gpt-5.5',
  });
  assert.equal(session.modelOverride, 'gpt-5.5');
  assert.equal(session.brainPack, null);
  assert.equal(session.provider, 'openai-native');
  assert.equal(session.model, 'gpt-5.5');
  assert.match(session.messages.at(-1)?.body ?? '', /Model switched/);
});

test('authoritative machine changes replace reconstructed tool arguments', () => {
  const generated = { path: 'src/generated.ts', kind: 'added' as const, before: '', after: 'generated', diff: '+generated' };
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), { type: 'changes', changes: [generated] });
  assert.deepEqual(session.changes, [generated]);
});

test('real Cline facade events finish the visible thread without duplicate text', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Inspect this');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'text', text: 'The implementation is sound.',
  } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'done', reason: 'completed', text: 'The implementation is sound.', iterations: 1,
  } } } });
  assert.equal(session.state, 'completed');
  assert.equal(session.activeActivity, null);
  assert.equal(session.messages.filter((item) => item.body === 'The implementation is sound.').length, 1);
});

test('non-success Cline termination reasons never render as completed', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Inspect this');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'done', reason: 'max_iterations', text: 'I could not finish safely.', iterations: 20,
  } } } });
  assert.equal(session.state, 'resumable');
  assert.notEqual(session.messages.at(-1)?.tone, 'success');
  session = applyRemoteEngineeringEvent(session, { type: 'ended', reason: 'error' });
  assert.equal(session.state, 'error');
});

test('reasoning streams live, then collapses into one disclosure when answer text starts', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Inspect this');
  for (const reasoning of ['I should inspect ', 'the repository first.']) {
    session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
      type: 'content_start', contentType: 'reasoning', reasoning, redacted: false,
    } } } });
  }
  const thought = session.messages.at(-1)!;
  assert.equal(thought.role, 'reasoning');
  assert.equal(thought.streaming, true);
  assert.equal(thought.collapsed, false);
  assert.equal(thought.body, 'I should inspect the repository first.');

  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_start', contentType: 'text', text: 'I found ', accumulated: 'I found ',
  } } } });
  assert.equal(session.messages.at(-2)?.role, 'reasoning');
  assert.equal(session.messages.at(-2)?.streaming, false);
  assert.equal(session.messages.at(-2)?.collapsed, true);
  assert.deepEqual(
    { role: session.messages.at(-1)?.role, body: session.messages.at(-1)?.body, streaming: session.messages.at(-1)?.streaming },
    { role: 'assistant', body: 'I found ', streaming: true },
  );

  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_start', contentType: 'text', text: 'the issue.', accumulated: 'I found the issue.',
  } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'text', text: 'I found the issue.',
  } } } });
  assert.equal(session.messages.at(-1)?.body, 'I found the issue.');
  assert.equal(session.messages.at(-1)?.streaming, false);
  assert.equal(session.messages.filter((item) => item.body === 'I found the issue.').length, 1);
});

test('redacted provider reasoning never exposes its payload', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'agent_event', event: { type: 'agent_event', payload: { event: {
      type: 'content_start', contentType: 'reasoning', reasoning: 'provider-secret-signature', redacted: true,
    } } },
  });
  assert.equal(session.messages.at(-1)?.role, 'reasoning');
  assert.equal(session.messages.at(-1)?.body, 'Reasoning is private for the selected model.');
  assert.doesNotMatch(session.messages.at(-1)?.body ?? '', /provider-secret-signature/);
});

test('a typed Plan-mode block offers Act continuation without a duplicate failure warning', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Implement the plan');
  session = applyRemoteEngineeringEvent(session, { type: 'mode_blocked', category: 'edit', toolName: 'apply_patch' });
  assert.equal(session.pendingModeHandoff?.category, 'edit');
  const before = session.messages.length;
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'tool', toolName: 'apply_patch', error: 'Blocked by Neuramesh Plan mode',
  } } } });
  assert.equal(session.messages.length, before);
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'done', reason: 'completed', text: 'The plan is ready.', iterations: 1,
  } } } });
  assert.equal(session.state, 'completed');
  assert.equal(session.pendingModeHandoff?.category, 'edit');
});

test('Plan-ceiling failures never flash as errors when their receipt beats the handoff event', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Inspect and verify the fix');
  const before = session.messages.length;
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'tool', toolName: 'run_commands', error: { error: 'Blocked by Neuramesh Plan mode' },
  } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'notice', message: '1 tool call(s) failed: [run_commands] {"error":"Blocked by Neuramesh Plan mode"}',
  } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'error', recoverable: true,
    error: { message: '1 tool call(s) failed: [run_commands] {"error":"Blocked by Neuramesh Plan mode"}' },
  } } } });
  session = applyRemoteEngineeringEvent(session, {
    type: 'error', recoverable: true,
    message: '1 tool call(s) failed: [run_commands] {"error":"Blocked by Neuramesh Plan mode"}',
  });
  assert.equal(session.messages.length, before);
  assert.equal(session.state, 'streaming');
  session = applyRemoteEngineeringEvent(session, { type: 'mode_blocked', category: 'command', toolName: 'run_commands' });
  assert.equal(session.pendingModeHandoff?.category, 'command');
});

test('a Plan-blocked command continues with implementation before verification', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Plan and verify the fix');
  session = applyRemoteEngineeringEvent(session, { type: 'mode_blocked', category: 'command', toolName: 'run_commands' });
  assert.equal(session.pendingModeHandoff?.category, 'command');
  assert.match(session.pendingModeHandoff?.prompt ?? '', /Apply the planned changes, run the requested commands/);
});

test('a verification probe cannot downgrade a completed implementation Plan', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Plan and verify the fix');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'text', text: 'Update the greeting and run its focused test.',
  } } } });
  assert.equal(session.pendingModeHandoff?.category, 'edit');
  session = applyRemoteEngineeringEvent(session, { type: 'mode_blocked', category: 'command', toolName: 'run_commands' });
  assert.equal(session.pendingModeHandoff?.category, 'edit');
  assert.match(session.pendingModeHandoff?.prompt ?? '', /Apply the planned changes and verify them/);
});

test('a completed Plan offers the same Act handoff when the model respects read-only mode', () => {
  let session = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Plan the smallest safe fix');
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'content_end', contentType: 'text', text: 'Inspect the parser, update the guard, and run its focused test.',
  } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: {
    type: 'done', reason: 'completed', text: 'Inspect the parser, update the guard, and run its focused test.', iterations: 1,
  } } } });
  assert.equal(session.state, 'completed');
  assert.equal(session.pendingModeHandoff?.category, 'edit');
  assert.match(session.pendingModeHandoff?.prompt ?? '', /Continue with the implementation in Act mode/);
});

test('remote Cline snapshots become real restorable checkpoint ids', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), {
    type: 'agent_event', event: { type: 'session_snapshot', payload: { snapshot: { checkpoint: { history: [{ ref: 'abc', createdAt: 1000, runCount: 2 }] } } } },
  });
  assert.equal(session.checkpoints[0]?.id, 'cline-run-2');
});

test('transport failures terminate streaming state and offer a retry', () => {
  const started = beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Inspect this');
  const failed = failRemoteEngineeringTransport(started, new Error('The attachment upload timed out.'));
  assert.equal(failed.state, 'resumable');
  assert.equal(failed.activeActivity, null);
  assert.equal(failed.messages.some((item) => item.streaming), false);
  assert.match(failed.messages.at(-1)?.body ?? '', /timed out.*Retry/i);
});
