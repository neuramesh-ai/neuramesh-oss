import { describe, expect, it } from 'vitest';
import { applyRemoteEngineeringEvent, createEngineeringSession, engineeringEffort, isEngineeringCommand, isEngineeringOpenMeta, isEngineeringSelection, STARTER_MODEL } from '../src';
const rex = { id: 'rex-id', name: 'rex', role: 'orchestrator' };
const patch = { id: 'patch-id', name: 'patch', role: 'developer' };
const initial = () => createEngineeringSession({ id: 'repo', name: 'app', owner: 'acme', branch: 'main', root: null });

describe('coding composer choices', () => {
  it('validates the atomic agent, model and effort contract on both relay entry points', () => {
    const selection = { agentId: rex.id, modelId: 'gpt-5.6-sol', reasoningEffort: 'high' };
    expect(isEngineeringCommand({ type: 'configure', selection })).toBe(true);
    const s = initial();
    expect(isEngineeringOpenMeta({ ...selection, threadId: s.id, repoId: 'repo', repoName: 'app', branch: 'main', mode: s.mode, permissions: s.permissions, policy: s.policy })).toBe(true);
    for (const change of [{ agentId: '' }, { modelId: 'invented' }, { reasoningEffort: 'ultra' }, { agentId: { name: 'injected' } }]) {
      expect(isEngineeringSelection({ ...selection, ...change })).toBe(false);
    }
  });
  it('shows and sends the same default effort and clears it for a model without choices', () => {
    expect(engineeringEffort('gpt-5.6-sol')).toBe('medium');
    expect(engineeringEffort('claude-haiku-4-5', 'high')).toBe('high');
    expect(engineeringEffort(STARTER_MODEL, 'high')).toBeNull();
  });
  it('keeps earlier authors when another agent takes the next turn', () => {
    let s = applyRemoteEngineeringEvent(initial(), { type: 'ready', agent: rex, reasoningEffort: 'high', modelId: 'gpt-5.6-sol', model: 'gpt-5.6-sol', provider: 'openai' });
    s = applyRemoteEngineeringEvent(s, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_start', contentType: 'text', text: 'Rex answer' } } } });
    s = applyRemoteEngineeringEvent(s, { type: 'ended', reason: 'completed' });
    s = applyRemoteEngineeringEvent(s, { type: 'model_changed', agent: patch, reasoningEffort: 'low', modelId: 'gpt-5.6-sol', model: 'gpt-5.6-sol', provider: 'openai' });
    s = applyRemoteEngineeringEvent(s, { type: 'agent_event', event: { type: 'agent_event', payload: { event: { type: 'content_start', contentType: 'text', text: 'Patch answer' } } } });
    expect(s.messages.find((m) => m.body === 'Rex answer')?.agent).toEqual(rex);
    expect(s.messages.find((m) => m.body === 'Patch answer')?.agent).toEqual(patch);
    expect(s.agentId).toBe(patch.id);
    expect(s.reasoningEffort).toBe('low');
    expect(JSON.parse(JSON.stringify(s)).messages.find((m: {body:string}) => m.body === 'Rex answer').agent).toEqual(rex);
  });
});
