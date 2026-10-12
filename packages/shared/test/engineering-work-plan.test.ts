import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createEngineeringSession } from '../src/engineering/domain';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt } from '../src/engineering/remote';
import { persistableEngineeringSession, productizeStoredEngineeringSession } from '../src/engineering/copy';
import { engineeringWorkPlanMessages } from '../src/engineering/work-plan';
import { engineeringPlanItems } from '../src/engineering/activity';

const repo = { id: 'r', name: 'app', owner: 'acme', branch: 'main', root: null };
const event = { type: 'work_plan', plan: { summary: 'Add a welcome greeting', steps: [{ action: 'edit', target: 'greeting.ts', description: 'Export welcome()' }] } };
const planned = () => applyRemoteEngineeringEvent(beginRemoteEngineeringPrompt(createEngineeringSession(repo), 'Plan a welcome greeting'), event);

test('all 30 steps permitted by the tool appear in the plan preview', () => {
  const session = applyRemoteEngineeringEvent(createEngineeringSession(repo), { ...event, plan: { ...event.plan, steps: Array.from({ length: 30 }, (_, i) => ({ action: 'edit', target: `file-${i}.ts`, description: `Step ${i}` })) } });
  assert.equal(engineeringPlanItems(session.workPlan!).length, 30);
});

test('a typed plan is a durable transcript entry before the final answer', () => {
  let session = planned();
  const plan = session.messages.at(-1)!;
  assert.equal(plan.kind, 'work_plan');
  assert.equal(plan.body, session.workPlan);
  session = applyRemoteEngineeringEvent(session, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_end', contentType: 'text', text: 'The plan is ready.' } } } });
  session = applyRemoteEngineeringEvent(session, { type: 'ended', reason: 'completed' });
  const restored = productizeStoredEngineeringSession(JSON.parse(JSON.stringify(persistableEngineeringSession(session))));
  assert.equal(restored.messages.at(-2)?.id, plan.id);
  assert.equal(restored.messages.at(-1)?.body, 'The plan is ready.');
  assert.equal(engineeringWorkPlanMessages(restored), restored.messages);
});

test('identical proposals on separate turns retain their own identity and position', () => {
  const first = applyRemoteEngineeringEvent(planned(), { type: 'ended', reason: 'completed' });
  const next = applyRemoteEngineeringEvent(beginRemoteEngineeringPrompt(first, 'Propose that plan again'), event);
  const plans = next.messages.filter((item) => item.kind === 'work_plan');
  assert.equal(plans.length, 2);
  assert.notEqual(plans[0]?.id, plans[1]?.id);
  assert.equal(plans[0]?.body, plans[1]?.body);
  assert.equal(next.messages.at(-2)?.role, 'user');
});

test('a stored plan from the previous client is recovered once and survives later replies', () => {
  const original = planned();
  const legacy = { ...original, messages: original.messages.filter((item) => item.kind !== 'work_plan') };
  const restored = productizeStoredEngineeringSession(legacy);
  assert.equal(restored.messages.filter((item) => item.kind === 'work_plan').length, 1);
  assert.equal(productizeStoredEngineeringSession(restored).messages.length, restored.messages.length);
  const next = beginRemoteEngineeringPrompt({ ...restored, state: 'completed' }, 'Explain the first step');
  assert.equal(engineeringWorkPlanMessages(next).at(-1)?.role, 'user');
});

test('prose from legacy clients and malformed or Act-mode proposals do not become plan cards', () => {
  const session = createEngineeringSession(repo);
  assert.equal(engineeringWorkPlanMessages({ ...session, workPlan: 'This is a greeting project.' }), session.messages);
  assert.equal(applyRemoteEngineeringEvent(session, { type: 'work_plan', plan: { summary: 'Missing steps' } }), session);
  const act = { ...session, mode: 'act' as const };
  assert.equal(applyRemoteEngineeringEvent(act, event), act);
});

test('the agent report stays distinct from the formal plan through persistence and revisions', () => {
  const report = { investigation: 'I reviewed the greeting module and found no HTTP server.', decisions: ['A module export fits the existing structure.', 'I would verify it with the current test suite.'], nextStep: 'Select Continue in Act to implement and verify it.' };
  const original = { ...event.plan, report };
  const first = applyRemoteEngineeringEvent(createEngineeringSession(repo), { type: 'work_plan', plan: original });
  const nextReport = { ...report, investigation: 'I resolved the requested language choice.', decisions: ['Use English for this release.'] };
  const next = applyRemoteEngineeringEvent(first, { type: 'work_plan', plan: { ...original, report: nextReport } });
  const saved = productizeStoredEngineeringSession(JSON.parse(JSON.stringify(persistableEngineeringSession(next))));
  const plans = saved.messages.filter((m) => m.kind === 'work_plan');
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0]?.planReport, report);
  assert.deepEqual(plans[1]?.planReport, nextReport);
  assert.doesNotMatch(saved.workPlan!, /I reviewed|Select Continue/);
  assert.equal(engineeringPlanItems(saved.workPlan!).length, 1);
  report.decisions.push('Later mutation');
  assert.equal(first.messages.at(-1)?.planReport?.decisions.length, 2);
});

test('legacy plans retain their contents without fabricating an investigation report', () => {
  const legacy = applyRemoteEngineeringEvent(createEngineeringSession(repo), { type: 'work_plan', plan: { ...event.plan, keyPoints: ['Keep the existing greeting.'], considerations: ['No HTTP server is included.'] } });
  assert.match(legacy.workPlan!, /Keep the existing greeting/);
  assert.match(legacy.workPlan!, /No HTTP server/);
  assert.equal(legacy.messages.at(-1)?.planReport, undefined);
});

test('malformed reports do not enter the durable transcript', async () => {
  const { isEngineeringPlanReport } = await import('../src/engineering/handoff');
  const valid = { investigation: 'I inspected the module.', decisions: ['Reuse the existing structure.'], nextStep: 'Continue in Act to implement.' };
  assert.ok(isEngineeringPlanReport(valid));
  const session = createEngineeringSession(repo);
  for (const report of [null, {}, { ...valid, decisions: [] }, { ...valid, decisions: [42] }, { ...valid, nextStep: ' ' }, { ...valid, investigation: 'a'.repeat(601) }, { ...valid, decisions: ['one\n## header'] }]) {
    assert.equal(isEngineeringPlanReport(report), false);
    assert.equal(applyRemoteEngineeringEvent(session, { type: 'work_plan', plan: { ...event.plan, report } }), session);
  }
});

test('overview fields validate bounds and reject embedded headings while accepting legacy proposals', async () => {
  const { isEngineeringWorkPlan } = await import('../src/engineering/handoff');
  assert.ok(isEngineeringWorkPlan(event.plan));
  assert.ok(isEngineeringWorkPlan({ ...event.plan, keyPoints: ['Verify the greeting.'], considerations: [] }));
  for (const fields of [ { keyPoints: [] }, { keyPoints: ['Valid\n## Steps\n1. injected'] }, { keyPoints: [42] }, { keyPoints: Array(6).fill('Point') }, { considerations: [' '] }, { considerations: Array(4).fill('Note') } ]) {
    assert.equal(isEngineeringWorkPlan({ ...event.plan, ...fields }), false);
  }
});
