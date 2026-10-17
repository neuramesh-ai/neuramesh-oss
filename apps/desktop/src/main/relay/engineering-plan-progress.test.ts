import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringPlanTool, engineeringProgressTool, workPlanProblem } from './engineering-plan';
import { engineeringRuntimeInput } from './engineering-runtime-input';
import { ENGINEERING_CLINE_TOOL_POLICIES, type EngineeringRuntimeEvent } from '@neuramesh/shared';
const plan = { summary: 'Implement', steps: [{ action: 'edit', target: 'a.ts', description: 'Fix the issue' }] };
test('progress uses successful current history, including rewind and errors', async () => {
  const events: EngineeringRuntimeEvent[] = [];
  const emit = (e: EngineeringRuntimeEvent) => events.push(e);
  const result = engineeringPlanTool(emit).execute(plan);
  let history: unknown[] = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'p', content: JSON.stringify(result) }] },
  ];
  const tool = engineeringProgressTool(emit, async () => history);
  const update = await tool.execute({ updates: [{ step: 1, status: 'completed' }] });
  assert.deepEqual(update.planProgress.statuses, ['completed']);
  assert.equal(events.at(-1)?.type, 'plan_progress');
  await assert.rejects(tool.execute({ updates: [{ step: 2, status: 'completed' }] }));
  history = []; // checkpoint before proposal
  await assert.rejects(engineeringProgressTool(emit, async () => history).execute({ updates: [{ step: 1, status: 'completed' }] }), /No recorded/);
});
test('Act and Plan register only their own side-effect-free plan tools', () => {
  const permissions = { read: true, edit: false, command: false, web: false, mcp: false };
  for (const mode of ['act', 'plan'] as const) {
    const input = engineeringRuntimeInput({ meta: { threadId: 't', repoId: 'r', repoName: 'r', branch: 'main', actorId: 'a', mode, permissions, policy: permissions }, cwd: '/tmp', provider: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' }, modelId: null, brainPack: null, controls: { mode, permissions, policy: permissions }, emit: () => {} });
    assert.deepEqual(input.localRuntime?.extraTools?.map(tool => tool.name), [mode === 'act' ? 'update_plan_progress' : 'propose_work_plan']);
  }
  assert.equal(ENGINEERING_CLINE_TOOL_POLICIES.update_plan_progress?.autoApprove, true);
});

test('successive and concurrent progress calls preserve prior steps while native snapshots lag', async () => {
  const p = { ...plan, steps: [...plan.steps, { ...plan.steps[0]!, target: 'b.ts' }, { ...plan.steps[0]!, target: 'c.ts' }] };
  const proposal = engineeringPlanTool(() => {}).execute(p);
  const history = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'propose_work_plan', input: p }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'p', content: JSON.stringify(proposal) }] },
  ];
  const tool = engineeringProgressTool(() => {}, async () => history);
  await tool.execute({ updates: [{ step: 1, status: 'in_progress' }] });
  const a = tool.execute({ updates: [{ step: 1, status: 'completed' }, { step: 2, status: 'in_progress' }] });
  const b = tool.execute({ updates: [{ step: 2, status: 'completed' }, { step: 3, status: 'in_progress' }] });
  assert.deepEqual((await a).planProgress.statuses, ['completed', 'in_progress', 'pending']);
  assert.deepEqual((await b).planProgress.statuses, ['completed', 'completed', 'in_progress']);
  assert.deepEqual((await tool.execute({ updates: [{ step: 3, status: 'completed' }] })).planProgress.statuses, ['completed', 'completed', 'completed']);
});

test('a resumed progress tool starts from durable progress when the native snapshot omits updates', async () => {
  const initial = engineeringPlanTool(() => {}).execute(plan).planProgress;
  const complete = { ...initial, started: true, statuses: initial.statuses.map(() => 'completed' as const) };
  const tool = engineeringProgressTool(() => {}, async () => [], async () => complete);
  const result = await tool.execute({ updates: [{ step: 1, status: 'in_progress' }] });
  assert.equal(result.planProgress.statuses[0], 'in_progress');
  assert.deepEqual(result.planProgress.statuses.slice(1), complete.statuses.slice(1));
});

test('a refused plan names the rule it broke', () => {
  const report = { investigation: 'I read a.ts.', decisions: ['Keep it small.', 'x'.repeat(315)], nextStep: 'Select Continue in Act.' };
  assert.throws(() => engineeringPlanTool(() => {}).execute({ ...plan, report }), /report\.decisions\[1\] must be one line of at most 300 characters/);
  assert.match(workPlanProblem(JSON.stringify(plan)), /JSON object, not as a string/);
  assert.match(workPlanProblem({ summary: 'Implement', steps: [] }), /steps must hold 1 to 30 items/);
  assert.match(workPlanProblem({ ...plan, steps: [{ ...plan.steps[0]!, label: 'a\nb' }] }), /steps\[0\] needs/);
  assert.match(workPlanProblem({ ...plan, summary: ' ' }), /summary must be text/);
  assert.match(workPlanProblem({ ...plan, considerations: ['a', 'b', 'c', 'd'] }), /considerations must hold 0 to 3 items/);
});
