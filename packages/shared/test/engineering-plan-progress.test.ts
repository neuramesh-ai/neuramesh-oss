import { test, expect } from 'vitest';
import { createEngineeringPlanProgress, updateEngineeringPlanProgress, recoverEngineeringPlanProgress, isEngineeringPlanProgress } from '../src/engineering/plan-progress';
import { createEngineeringSession } from '../src/engineering/domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt } from '../src/engineering/remote';
import { persistableEngineeringSession, productizeStoredEngineeringSession } from '../src/engineering/copy';
import { restoreEngineeringCheckpoint } from '../src/engineering/checkpoints';
const plan = { summary: 'Fix the formatter', steps: [
  { action: 'edit' as const, target: 'src/format.ts', description: 'Implement formatting', label: 'Fix duration formatting' },
  { action: 'command' as const, target: 'npm test', description: 'Verify the test suite' },
] };
const initial = () => createEngineeringPlanProgress(plan, 'plan-a');
const session = () => createEngineeringSession({ id: 'r', name: 'r', owner: 'acme', root: null, branch: 'main' });
const receipt = (name: string, input: unknown, result: unknown, id = 'call', error = false) => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(result), is_error: error }] },
];
test('progress starts only in Act and approval/turn completion never completes steps', () => {
  let s = applyRemoteEngineeringEvent(session(), { type: 'work_plan', plan, planId: 'plan-a' });
  expect(s.planProgress?.started).toBe(false);
  s = beginRemoteEngineeringPrompt({ ...s, mode: 'act' }, 'Continue');
  expect(s.planProgress?.started).toBe(true);
  for (const event of [{ type: 'approval_resolved', approvalId: 'a', approved: true }, { type: 'ended', reason: 'completed' }]) s = applyRemoteEngineeringEvent(s, event);
  expect(s.planProgress?.statuses).toEqual(['pending', 'pending']);
});
test('explicit updates are atomic, preserve the plan, and allow rework', () => {
  const p = updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'in_progress' }]);
  const next = updateEngineeringPlanProgress(p, [{ step: 1, status: 'completed' }, { step: 2, status: 'in_progress' }]);
  expect(p.statuses).toEqual(['in_progress', 'pending']);
  expect(next.statuses).toEqual(['completed', 'in_progress']);
  expect(updateEngineeringPlanProgress(next, [{ step: 2, status: 'pending' }, { step: 1, status: 'in_progress' }]).statuses).toEqual(['in_progress', 'pending']);
});
test('invalid updates cannot corrupt the checklist', () => {
  for (const updates of [[], null, [{ step: 0, status: 'completed' }], [{ step: 3, status: 'completed' }], [{ step: 1.5, status: 'pending' }], [{ step: 1, status: 'done' }], [{ step: 1, status: 'pending' }, { step: 1, status: 'completed' }], [{ step: 1, status: 'in_progress' }, { step: 2, status: 'in_progress' }]]) expect(() => updateEngineeringPlanProgress(initial(), updates)).toThrow();
  expect(isEngineeringPlanProgress({ ...initial(), statuses: ['completed', 'pending'] })).toBe(false);
  expect(applyRemoteEngineeringEvent(session(), { type: 'plan_progress', progress: {} }).planProgress).toBeUndefined();
});
test('successful portable receipts recover the same progress after model/device handoff', () => {
  const next = updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'completed' }, { step: 2, status: 'in_progress' }]);
  const messages = [...receipt('propose_work_plan', plan, { recorded: true, planProgress: initial() }), ...receipt('update_plan_progress', {}, { recorded: true, planProgress: next }, 'update')];
  expect(recoverEngineeringPlanProgress(JSON.parse(JSON.stringify(messages)))).toEqual(next);
  expect(recoverEngineeringPlanProgress([...messages, ...receipt('update_plan_progress', {}, { recorded: true, planProgress: { ...next, id: 'stale' } }, 'stale')])).toEqual(next);
});
test('legacy successful plans recover; failed or unfinished calls and prose do not', () => {
  expect(recoverEngineeringPlanProgress(receipt('propose_work_plan', plan, { recorded: true }))?.statuses).toEqual(['pending', 'pending']);
  expect(recoverEngineeringPlanProgress(receipt('propose_work_plan', plan, { recorded: true }, 'call', true))).toBeNull();
  expect(recoverEngineeringPlanProgress(receipt('propose_work_plan', plan, { recorded: true }).slice(0, 1))).toBeNull();
  expect(recoverEngineeringPlanProgress([{ role: 'assistant', content: 'All steps completed!' }])).toBeNull();
});
test('reload preserves counts and a revised plan resets its own checklist', () => {
  let s = applyRemoteEngineeringEvent(session(), { type: 'plan_progress', progress: updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'completed' }]) });
  s = productizeStoredEngineeringSession(JSON.parse(JSON.stringify(persistableEngineeringSession(s))));
  expect(s.planProgress?.statuses).toEqual(['completed', 'pending']);
  s = applyRemoteEngineeringEvent(s, { type: 'work_plan', plan, planId: 'new' });
  expect(s.planProgress?.id).toBe('new'); expect(s.planProgress?.started).toBe(false);
});
test('checkpoint restores its progress and raw history truncation discards future updates', () => {
  const s = { ...session(), planProgress: updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'completed' }]), checkpoints: [{ id: 'cp', label: 'Before', createdAt: '', messageCount: 0, changes: [], workPlan: '', planProgress: initial() }] };
  expect(restoreEngineeringCheckpoint(s, 'cp').planProgress).toEqual(initial());
  expect(recoverEngineeringPlanProgress(receipt('propose_work_plan', plan, { recorded: true, planProgress: initial() }))).toEqual(initial());
});
test('later native snapshots do not overwrite an earlier checkpoint with current progress', () => {
  const snapshot = { type: 'agent_event', event: { type: 'session_snapshot', payload: { snapshot: { checkpoint: { history: [{ runCount: 1, createdAt: 1 }] } } } } };
  let s = applyRemoteEngineeringEvent({ ...session(), planProgress: initial() }, snapshot);
  const first = s.checkpoints[0];
  s = applyRemoteEngineeringEvent({ ...s, planProgress: updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'completed' }]) }, snapshot);
  expect(s.checkpoints[0]).toEqual(first);
  expect(applyRemoteEngineeringEvent(s, { type: 'restored', checkpointRunCount: 1 }).planProgress?.statuses).toEqual(['pending', 'pending']);
});

test('a fresh device restores the full plan alongside its progress without a browser cache', () => {
  const progress = updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'completed' }]);
  const restored = applyRemoteEngineeringEvent(session(), { type: 'plan_progress', progress });
  expect(restored.workPlan).toContain('1. Implement formatting');
  expect(restored.workPlan).toContain('2. Verify the test suite');
  expect(restored.planProgress).toEqual(progress);
});

test('recoverable core errors keep execution live until an explicit terminal event', () => {
  const progress = updateEngineeringPlanProgress(initial(), [{ step: 1, status: 'in_progress' }]);
  const active = { ...session(), mode: 'act' as const, state: 'streaming' as const, planProgress: progress };
  const recovering = applyRemoteEngineeringEvent(active, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'error', recoverable: true, iteration: 1, error: { message: 'A tool call failed; trying another approach.' } } } } });
  expect(recovering.state).toBe('streaming');
  expect(recovering.activeActivity?.phase).toBe('thinking');
  expect(recovering.planProgress).toEqual(progress);
  expect(applyRemoteEngineeringEvent(recovering, { type: 'ended', reason: 'completed' }).state).toBe('completed');
  expect(applyRemoteEngineeringEvent(recovering, { type: 'ended', reason: 'error' }).state).toBe('error');
  expect(applyRemoteEngineeringEvent(active, { type: 'error', recoverable: true, message: 'Connection lost' }).state).toBe('resumable');
});
