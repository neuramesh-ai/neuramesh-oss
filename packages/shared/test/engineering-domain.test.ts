import { test } from 'vitest';
import assert from 'node:assert/strict';
import { combinedDiff, restoreEngineeringCheckpoint } from '../src/engineering/checkpoints';
import {
  continueEngineeringInAct,
  createEngineeringSession,
  dismissEngineeringModeHandoff,
  effectivePermission,
  resolveEngineeringApproval,
  setEngineeringBrainPack,
  setEngineeringMode,
  setEngineeringModel,
  setEngineeringPermission,
  setEngineeringPolicy,
  submitEngineeringPrompt,
  type EngineeringRepo,
} from '../src/engineering/domain';

const repo: EngineeringRepo = { id: 'r1', name: 'neuramesh', owner: 'acme', branch: 'main', root: '/code/neuramesh' };

test('recommended defaults auto-approve reads and ask before every side effect', () => {
  const session = createEngineeringSession(repo);
  assert.deepEqual(session.permissions, { read: true, edit: false, command: false, web: false, mcp: false });
  assert.equal(effectivePermission('plan', 'read', session.permissions, session.policy), 'auto');
  assert.equal(effectivePermission('act', 'edit', session.permissions, session.policy), 'ask');
  assert.equal(effectivePermission('act', 'command', session.permissions, session.policy), 'ask');
});

test('Plan is structurally read-only even when stale session toggles say otherwise', () => {
  let session = createEngineeringSession(repo);
  session = setEngineeringPermission(session, 'edit', true);
  session = setEngineeringPermission(session, 'command', true);
  assert.equal(effectivePermission('plan', 'edit', session.permissions, session.policy), 'blocked');
  assert.equal(effectivePermission('plan', 'command', session.permissions, session.policy), 'blocked');

  session = submitEngineeringPrompt(session, 'Investigate the auth callback race');
  assert.equal(session.state, 'completed');
  assert.match(session.workPlan ?? '', /Work Plan/);
  assert.equal(session.changes.length, 0);
  assert.match(session.messages.at(-1)?.body ?? '', /No files were changed/);
  assert.equal(session.pendingModeHandoff?.category, 'edit');
});

test('the Plan handoff switches to Act and submits the continuation in one action', () => {
  let session = submitEngineeringPrompt(createEngineeringSession(repo), 'Plan the auth fix');
  const prompt = session.pendingModeHandoff?.prompt;
  assert.ok(prompt);

  session = continueEngineeringInAct(session);
  assert.equal(session.mode, 'act');
  assert.equal(session.pendingModeHandoff, null);
  assert.equal(session.state, 'awaiting_approval');
  assert.equal(session.pendingApproval?.category, 'edit');
  assert.equal(session.messages.some((item) => item.role === 'user' && item.body === prompt), true);
});

test('the Plan handoff can be dismissed without changing modes or submitting work', () => {
  const planned = submitEngineeringPrompt(createEngineeringSession(repo), 'Plan the auth fix');
  const dismissed = dismissEngineeringModeHandoff(planned);
  assert.equal(dismissed.mode, 'plan');
  assert.equal(dismissed.pendingModeHandoff, null);
  assert.equal(dismissed.messages.length, planned.messages.length);
});

test('Act exposes the complete patch before edit approval, then separately gates commands', () => {
  let session = setEngineeringMode(createEngineeringSession(repo), 'act');
  session = submitEngineeringPrompt(session, 'Fix the auth callback race and add tests');
  assert.equal(session.state, 'awaiting_approval');
  assert.equal(session.pendingApproval?.category, 'edit');
  assert.equal(session.pendingApproval?.changes?.length, 2);
  assert.match(combinedDiff(session.pendingApproval?.changes ?? []), /AuthCallback\.test\.tsx/);
  assert.equal(session.changes.length, 0, 'pre-approval diff is not applied state');

  session = resolveEngineeringApproval(session, true);
  assert.equal(session.pendingApproval?.category, 'command');
  assert.equal(session.changes.length, 2);
  assert.equal(session.state, 'awaiting_approval');

  session = resolveEngineeringApproval(session, true);
  assert.equal(session.state, 'completed');
  assert.equal(session.pendingApproval, null);
  assert.match(session.messages.at(-1)?.body ?? '', /Implemented and verified/);
});

test('auto-approved edit and command advance without approval cards', () => {
  let session = setEngineeringMode(createEngineeringSession(repo), 'act');
  session = setEngineeringPermission(session, 'edit', true);
  session = setEngineeringPermission(session, 'command', true);
  session = submitEngineeringPrompt(session, 'Implement the planned fix');
  assert.equal(session.state, 'completed');
  assert.equal(session.pendingApproval, null);
  assert.equal(session.changes.length, 2);
});

test('workspace policy wins over session auto-approval', () => {
  let session = setEngineeringMode(createEngineeringSession(repo), 'act');
  session = setEngineeringPermission(session, 'edit', true);
  session = setEngineeringPolicy(session, { edit: false });
  session = submitEngineeringPrompt(session, 'Try to edit blocked files');
  assert.equal(session.state, 'error');
  assert.equal(session.changes.length, 0);
  assert.match(session.messages.at(-1)?.body ?? '', /blocked by the effective workspace policy/);
});

test('mode and auto-approval controls cannot drift while a turn or approval is active', () => {
  const streaming = { ...createEngineeringSession(repo), state: 'streaming' as const };
  assert.equal(setEngineeringMode(streaming, 'act'), streaming);
  assert.equal(setEngineeringPermission(streaming, 'edit', true), streaming);
  assert.equal(setEngineeringBrainPack(streaming, 'openai-core'), streaming);
  assert.equal(setEngineeringModel(streaming, 'gpt-5.5'), streaming);

  const awaiting = { ...createEngineeringSession(repo), state: 'awaiting_approval' as const };
  assert.equal(setEngineeringMode(awaiting, 'act'), awaiting);
  assert.equal(setEngineeringPermission(awaiting, 'command', true), awaiting);
  assert.equal(setEngineeringBrainPack(awaiting, 'openai-core'), awaiting);
  assert.equal(setEngineeringModel(awaiting, 'gpt-5.5'), awaiting);
});

test('an idle Engineering thread can select and reset its task-scoped brain pack', () => {
  const session = createEngineeringSession(repo);
  const selected = setEngineeringBrainPack(session, 'openai-core');
  assert.equal(selected.brainPack, 'openai-core');
  assert.equal(setEngineeringBrainPack(selected, null).brainPack, null);
});

test('an idle Code thread selects one model directly and clears a legacy pack selection', () => {
  const legacy = setEngineeringBrainPack(createEngineeringSession(repo), 'openai-core');
  const selected = setEngineeringModel(legacy, 'gpt-5.6-sol');
  assert.equal(selected.modelOverride, 'gpt-5.6-sol');
  assert.equal(selected.brainPack, null);
  assert.equal(setEngineeringModel(selected, null).modelOverride, null);
});

test('declining an approval is resumable and checkpoints restore files independently', () => {
  let session = setEngineeringMode(createEngineeringSession(repo), 'act');
  session = submitEngineeringPrompt(session, 'Fix it');
  session = resolveEngineeringApproval(session, false);
  assert.equal(session.state, 'resumable');
  assert.equal(session.changes.length, 0);

  session = setEngineeringPermission(session, 'edit', true);
  session = setEngineeringPermission(session, 'command', true);
  session = submitEngineeringPrompt(session, 'Try again');
  assert.equal(session.state, 'completed');
  assert.equal(session.changes.length, 2);
  const beforeEdits = session.checkpoints.find((c) => c.label === 'Before file edits')!;
  session = restoreEngineeringCheckpoint(session, beforeEdits.id);
  assert.equal(session.state, 'resumable');
  assert.equal(session.changes.length, 0);
  assert.match(session.messages.at(-1)?.body ?? '', /Restored checkpoint/);
});
