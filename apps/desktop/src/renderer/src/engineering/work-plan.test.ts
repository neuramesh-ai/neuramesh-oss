import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, createEngineeringSession } from '@neuramesh/shared';
import { workPlanArrival } from './useWorkPlan';

const event = { type: 'work_plan', plan: { summary: 'Add welcome', steps: [{ action: 'edit', target: 'greeting.ts', description: 'Export welcome()' }] } };
const session = applyRemoteEngineeringEvent(beginRemoteEngineeringPrompt(createEngineeringSession({ id: 'r', name: 'app', owner: 'acme', branch: 'main', root: null }), 'Plan welcome'), event);

test('a proposal opens once and a manual close survives completion and later replies', () => {
  const seen = new Set<string>();
  assert.equal(workPlanArrival(seen, session), true);
  const completed = applyRemoteEngineeringEvent(session, { type: 'ended', reason: 'completed' });
  assert.equal(workPlanArrival(seen, completed), false);
  assert.equal(workPlanArrival(seen, beginRemoteEngineeringPrompt(completed, 'Explain this')), false);
});

test('a revised or identical new proposal and another thread can open again', () => {
  const seen = new Set<string>();
  assert.equal(workPlanArrival(seen, session), true);
  assert.equal(workPlanArrival(seen, applyRemoteEngineeringEvent(session, event)), true);
  assert.equal(workPlanArrival(seen, { ...session, id: 'another' }), true);
});

test('a restored typed proposal opens but historical plans do not interrupt Act or approvals', () => {
  const legacy = { ...session, messages: session.messages.filter((item) => item.kind !== 'work_plan') };
  assert.equal(workPlanArrival(new Set(), legacy), true);
  const seen = new Set<string>();
  const approval = applyRemoteEngineeringEvent(session, { type: 'approval', approvalId: 'a', category: 'edit', toolName: 'apply_patch', input: {}, changes: [] });
  assert.equal(workPlanArrival(seen, approval), false);
  assert.equal(workPlanArrival(seen, { ...approval, pendingApproval: null }), false);
  assert.equal(workPlanArrival(new Set(), { ...session, mode: 'act' }), false);
  assert.equal(workPlanArrival(new Set(), { ...legacy, pendingModeHandoff: null }), false);
  assert.equal(workPlanArrival(new Set(), null), false);
});
