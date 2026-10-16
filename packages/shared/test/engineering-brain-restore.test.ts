import { expect, it } from 'vitest';
import { restoreEngineeringBrain, createEngineeringSession, type BrainThreadSnapshot, type BrainConversationEvent } from '../src';
const shell = () => ({ ...createEngineeringSession({ id: 'repo', name: 'repo', owner: 'acme', branch: 'main', root: null }), id: 'thread' });
const agent = { id: 'rex', name: 'rex', role: 'orchestrator' };
const event = (type: string, payload: unknown, id: string): BrainConversationEvent => ({ id, type, payload, timestamp: '2026-10-10T00:00:00Z' });
const core = (body: Record<string, unknown>, id: string) => event('runtime.event', { type: 'agent_event', payload: { event: body } }, id);
const snapshot = (events: BrainConversationEvent[], extra: Partial<BrainThreadSnapshot> = {}): BrainThreadSnapshot => ({ workspace: 'workspace', threadId: 'thread', revision: 1, events, ...extra });
it('restores original authors, turns, exact file snapshots and progress without replaying approvals', () => {
  const change = { path: 'a.js', kind: 'modified', before: 'old\n', after: 'new\n', diff: '@@ -1 +1 @@\n-old\n+new\n' };
  const plan = { summary: 'Fix the greeting', report: { investigation: 'I inspected the greeting.', decisions: ['Preserve the API.'], nextStep: 'Continue in Act.' }, steps: [{ action: 'edit' as const, target: 'a.js', description: 'Fix greeting' }] };
  const events = [event('user.message', { text: 'Plan a fix', agent, mode: 'plan' }, 'u1'),
    core({ type: 'content_end', contentType: 'tool', toolName: 'propose_work_plan', toolCallId: 'plan' }, 'p'),
    event('user.message', { text: 'Continue', agent, mode: 'act' }, 'u2'),
    event('tool.approval', { toolCallId: 'patch', toolName: 'apply_patch', input: {} }, 'a'),
    event('review.proposed', { approvalId: 'patch', changes: [change] }, 'r'),
    event('approval.resolved', { approvalId: 'patch', approved: true }, 'approved'),
    core({ type: 'content_end', contentType: 'tool', toolName: 'apply_patch', toolCallId: 'patch' }, 'done'),
    core({ type: 'content_end', contentType: 'text', text: 'Fixed.' }, 'text'),
    event('runtime.event', { type: 'ended', payload: { reason: 'completed' } }, 'end')];
  const recorded = snapshot(events, { metadata: { mode: 'act', selection: { agentId: 'rex', modelId: 'gpt-5.6-sol', reasoningEffort: 'high' }, agent }, runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plan', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plan', content: JSON.stringify({ recorded: true }) }] },
  ] });
  const out = restoreEngineeringBrain(shell(), recorded);
  expect(out.messages.filter(m => m.role === 'user').map(m => m.body)).toEqual(['Plan a fix', 'Continue']);
  expect(out.messages.find(m => m.kind === 'work_plan')?.planReport).toEqual(plan.report);
  expect(out.messages.find(m => m.review)?.review).toMatchObject({ status: 'applied', changes: [change] });
  expect(out.messages.find(m => m.body === 'Fixed.')?.agent).toEqual(agent);
  expect(out).toMatchObject({ state: 'completed', mode: 'act', agentId: 'rex', modelOverride: 'gpt-5.6-sol', reasoningEffort: 'high', pendingApproval: null });
  expect(restoreEngineeringBrain(shell(), recorded).messages.map(m => m.id)).toEqual(out.messages.map(m => m.id));
});
it('keeps interrupted edits as unknown receipts and never offers a stale permission', () => {
  const out = restoreEngineeringBrain(shell(), snapshot([
    event('user.message', { text: 'Fix it', agent, mode: 'act' }, 'u'),
    event('tool.approval', { toolCallId: 'patch', toolName: 'apply_patch', input: '*** Begin Patch\n*** Add File: a.js\n+hello\n*** End Patch' }, 'a'),
  ]));
  expect(out.state).toBe('resumable');
  expect(out.pendingApproval).toBeNull();
  expect(out.messages.find(m => m.review)?.review?.status).toBe('interrupted');
});
it('rejects a snapshot for another thread', () => {
  expect(() => restoreEngineeringBrain(shell(), { ...snapshot([]), threadId: 'other' })).toThrow('another thread');
});
it('keeps legacy transcript and review receipts when only a model change was recorded', () => {
  const cached = restoreEngineeringBrain(shell(), snapshot([
    event('user.message', { text: 'Fix it', agent, mode: 'act' }, 'u'),
    event('tool.approval', { toolCallId: 'patch', toolName: 'apply_patch', input: '*** Begin Patch\n*** Add File: a.js\n+hello\n*** End Patch' }, 'a'),
  ]));
  const out = restoreEngineeringBrain(cached, snapshot([event('model.change', { from: 'old', to: 'new' }, 'model')], {
    metadata: { selection: { agentId: 'rex', modelId: 'gpt-6-astra', reasoningEffort: 'medium' } },
  }));
  expect(out.messages).toEqual(cached.messages);
  expect(out.messages.find(m => m.review)?.review?.status).toBe('interrupted');
  expect(out).toMatchObject({ modelOverride: 'gpt-6-astra', pendingApproval: null, pendingModeHandoff: null, activeActivity: null });
  // Actual transcript records remain authoritative; do not append stale cached turns.
  const recorded = restoreEngineeringBrain(cached, snapshot([event('user.message', { text: 'Recorded task' }, 'new')]));
  expect(recorded.messages.filter(m => m.role === 'user').map(m => m.body)).toEqual(['Recorded task']);
});
it('a metadata-only revision keeps the cached Continue in Act offer and a cached error', () => {
  const handoff = { category: 'edit' as const, toolName: 'propose_work_plan', prompt: 'Continue in Act.', createdAt: '2026-10-10T00:00:00Z', actionable: true as const };
  const model = snapshot([event('model.change', { from: 'old', to: 'new' }, 'model')]);
  const planned = restoreEngineeringBrain({ ...shell(), mode: 'plan', state: 'completed', pendingModeHandoff: handoff }, model);
  expect(planned).toMatchObject({ mode: 'plan', state: 'completed', pendingModeHandoff: handoff, pendingApproval: null });
  expect(restoreEngineeringBrain({ ...shell(), state: 'error' }, model).state).toBe('error');
  // a cached live turn is stale: it reads as resumable, and its offer goes with it
  expect(restoreEngineeringBrain({ ...shell(), mode: 'plan', state: 'streaming', pendingModeHandoff: handoff }, model)).toMatchObject({ state: 'resumable', pendingModeHandoff: null });
});
it('refuses packed values instead of silently omitting history on an old API', () => {
  const packed = { brainEncoding: 'neuramesh.gzip.v1', data: 'compressed' };
  expect(() => restoreEngineeringBrain(shell(), snapshot([event('runtime.event', packed, 'packed')]))).toThrow('decode');
  expect(() => restoreEngineeringBrain(shell(), snapshot([], { runtimeMessages: [packed] }))).toThrow('decode');
});

it('restores explicit progress recorded after the last runtime checkpoint', () => {
  const plan = { summary: 'Repair', steps: [{ action: 'edit' as const, target: 'a.js', description: 'Repair greeting' }] };
  const initial = { id: 'plan-id', plan, statuses: ['pending'], started: false };
  const complete = { ...initial, statuses: ['completed'], started: true };
  const recorded = snapshot([
    core({ type: 'content_end', contentType: 'tool', toolName: 'propose_work_plan', toolCallId: 'plan-call' }, 'proposal'),
    core({ type: 'content_end', contentType: 'tool', toolName: 'update_plan_progress', toolCallId: 'progress-call', output: { recorded: true, planProgress: complete } }, 'progress'),
  ], { metadata: { mode: 'act', recordedEventCount: 1 }, runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plan-call', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plan-call', content: JSON.stringify({ recorded: true, planProgress: initial }) }] },
  ] });
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toEqual(complete);
  for (const invalid of [
    { output: { recorded: false, planProgress: complete } },
    { error: 'Update failed', output: { recorded: true, planProgress: complete } },
    { output: { recorded: true, planProgress: { ...complete, id: 'another-plan' } } },
    { output: { recorded: true, planProgress: { ...complete, plan: { ...plan, summary: 'A different plan' } } } },
    { contentType: 'text', text: 'All steps complete.', output: { recorded: true, planProgress: complete } },
  ]) {
    const tail = core({ type: 'content_end', contentType: 'tool', toolName: 'update_plan_progress', toolCallId: 'progress-call', ...invalid }, 'invalid');
    expect(restoreEngineeringBrain(shell(), { ...recorded, events: [recorded.events[0]!, tail] }).planProgress).toEqual(initial);
  }
  // Saving a later snapshot does not prove it retained every earlier plan receipt.
  expect(restoreEngineeringBrain(shell(), { ...recorded, metadata: { mode: 'act', recordedEventCount: 2 } }).planProgress).toEqual(complete);
});

it('a receipt that replays the proposal of the plan in progress keeps its steps', () => {
  const plan = { summary: 'Repair', steps: [{ action: 'edit' as const, target: 'a.js', description: 'Repair greeting' }] };
  const initial = { id: 'plan-call', plan, statuses: ['pending'], started: false };
  const complete = { ...initial, statuses: ['completed'], started: true };
  // the checkpoint holds the finished plan, and an event count that is too low replays the proposal's receipt
  const recorded = snapshot([
    core({ type: 'content_end', contentType: 'tool', toolName: 'propose_work_plan', toolCallId: 'plan-call', output: { recorded: true, planProgress: initial } }, 'proposal'),
  ], { metadata: { mode: 'act', recordedEventCount: 0 }, runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plan-call', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plan-call', content: JSON.stringify({ recorded: true, planProgress: initial }) }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'progress-call', name: 'update_plan_progress', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'progress-call', content: JSON.stringify({ recorded: true, planProgress: complete }) }] },
  ] });
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toEqual(complete);
});
it('with checkpoint progress and no event count, later receipts wait for the next checkpoint', () => {
  const plan = { summary: 'Repair', steps: [{ action: 'edit' as const, target: 'a.js', description: 'Repair greeting' }] };
  const initial = { id: 'plan-call', plan, statuses: ['pending'], started: false };
  const complete = { ...initial, statuses: ['completed'], started: true };
  // with no count, nothing says which events the checkpoint covers, so none of them may move its result
  const recorded = snapshot([
    core({ type: 'content_end', contentType: 'tool', toolName: 'update_plan_progress', toolCallId: 'progress-call', output: { recorded: true, planProgress: complete } }, 'progress'),
  ], { metadata: { mode: 'act' }, runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plan-call', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plan-call', content: JSON.stringify({ recorded: true, planProgress: initial }) }] },
  ] });
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toEqual(initial);
});
it('a newer recorded proposal resets the plan and only its own later receipts can update it', () => {
  const plan = { summary: 'Repair', steps: [{ action: 'edit' as const, target: 'a.js', description: 'Repair greeting' }] };
  const proposed = { id: 'new-plan', plan, statuses: ['pending'], started: false };
  const completed = { ...proposed, statuses: ['completed'], started: true };
  const receipt = (toolName: string, planProgress: unknown, id: string) => core({ type: 'content_end', contentType: 'tool', toolName, toolCallId: id, output: { recorded: true, planProgress } }, id);
  const events = [receipt('propose_work_plan', proposed, 'p'), receipt('update_plan_progress', { ...completed, id: 'old-plan' }, 'stale')];
  expect(restoreEngineeringBrain(shell(), snapshot(events)).planProgress).toEqual(proposed);
  events.push(receipt('update_plan_progress', completed, 'done'));
  const reopened = { ...completed, statuses: ['in_progress'] };
  events.push(receipt('update_plan_progress', reopened, 'reopen'));
  expect(restoreEngineeringBrain(shell(), snapshot(events)).planProgress).toEqual(reopened);
});

it('recovers completed steps omitted from a later snapshot and respects a deliberate rewind', () => {
  const plan = { summary: 'Deliver video', steps: [{ action: 'edit' as const, target: 'clip.mp4', description: 'Render and verify video' }] };
  const initial = { id: 'video-plan', plan, statuses: ['pending'], started: false };
  const completed = { ...initial, statuses: ['completed'], started: true };
  const output = (toolName: string, progress: unknown, id: string) => core({ type: 'content_end', contentType: 'tool', toolName, toolCallId: id, output: { recorded: true, planProgress: progress } }, id);
  const events = [output('propose_work_plan', initial, 'proposal'), output('update_plan_progress', completed, 'complete'), event('user.message', { text: 'Show the deliverables', mode: 'act' }, 'followup')];
  const recorded = snapshot(events, { metadata: { mode: 'act', recordedEventCount: 3 }, runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'proposal', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'proposal', content: JSON.stringify({ recorded: true, planProgress: initial }) }] },
    { role: 'user', content: [{ type: 'text', text: 'Show the deliverables' }] },
  ] });
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toEqual(completed);
  expect(restoreEngineeringBrain(shell(), { ...recorded, runtimeMessages: [] }).planProgress).toEqual(completed);
  events.push(event('plan.restored', { checkpointRunCount: 1, progress: initial }, 'rewind'));
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toEqual(initial);
  events.push(output('update_plan_progress', { ...completed, statuses: ['in_progress'] }, 'rework'));
  expect(restoreEngineeringBrain(shell(), recorded).planProgress?.statuses).toEqual(['in_progress']);
  events.push(event('plan.restored', { checkpointRunCount: 0, progress: null }, 'before-plan'));
  expect(restoreEngineeringBrain(shell(), recorded).planProgress).toBeNull();
});
