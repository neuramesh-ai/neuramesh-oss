import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClineCore } from '@cline/sdk';
import { resolveEngineeringBrain } from './engineering-brain';
import { engineeringRuntimeInput } from './engineering-runtime-input';
import { createClineEngineeringHost } from './engineering-host';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
const rex = { id: 'rex-id', name: 'rex', role: 'orchestrator', emoji: null };
const patch = { id: 'patch-id', name: 'patch', role: 'developer', emoji: null };
const meta: EngineeringMachineOpenMeta = { threadId: 'thread', actorId: 'human', repoId: 'repo', repoName: 'app', branch: 'main', mode: 'plan', modelId: 'gpt-5.6-sol', agentId: rex.id, reasoningEffort: 'high', permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
const opts = { apiUrl: 'https://api.test', machineToken: 'test', workspaceId: 'workspace' };

test('agent resolver selects Rex by default and rejects unavailable explicit identities', async () => {
  const calls: string[] = [];
  const db = { getAll: async <T>(sql: string, values?: unknown[]) => { calls.push(sql); return (sql.includes('from agents') && (!values?.[1] || values[1] === rex.id) ? [{ ...rex, brief: 'Explain decisions.', model: 'gpt-5.6-sol' }] : []) as T[]; } };
  const resolved = await resolveEngineeringBrain(db, opts, { repoId: 'repo' });
  assert.deepEqual(resolved.agent, rex);
  assert.equal(resolved.instructions, 'Explain decisions.');
  assert.match(calls[0]!, /role = 'orchestrator'/);
  await assert.rejects(resolveEngineeringBrain(db, opts, { repoId: 'repo', agentId: 'foreign-id' }), /agent is not available/);
});

test('runtime input uses the selected persona and effort, not a display-only alias', () => {
  const input = engineeringRuntimeInput({ meta, cwd: '/repo', provider: { providerId: 'openai', modelId: 'gpt-5.6-sol', agent: patch, instructions: 'Keep changes small.' }, modelId: 'gpt-5.6-sol', brainPack: null, controls: meta });
  assert.equal(input.config?.reasoningEffort, 'high');
  assert.match(String(input.config?.systemPrompt), /You are patch, the developer/);
  assert.match(String(input.config?.systemPrompt), /Keep changes small/);
  assert.deepEqual(input.sessionMetadata?.['agent'], patch);
});

test('same-model agent/effort changes restart the native session with its conversation intact and reject mid-turn changes', async () => {
  const starts: Parameters<ClineCore['start']>[0][] = [];
  const events: EngineeringRuntimeEvent[] = [];
  let emitNative: ((event: unknown) => void) | undefined;
  const messages = [{ role: 'user', content: 'Remember the marker composer-qa.' }];
  const fake = { subscribe: (fn: typeof emitNative) => { emitNative = fn; }, listHistory: async () => [], readMessages: async () => messages,
    start: async (input: Parameters<ClineCore['start']>[0]) => { starts.push(input); return { sessionId: `s${starts.length}` }; }, send: async () => {}, stop: async () => {}, dispose: async () => {} } as unknown as ClineCore;
  const host = createClineEngineeringHost({ ...opts, brainSync: false, resolveCwd: async () => '/repo', resolveBrain: async (m) => ({ modelId: m.modelId!, agent: m.agentId === patch.id ? patch : rex }),
    fetchImpl: async () => new Response(JSON.stringify({ token: 'test-key', authMode: 'apikey' })), createCore: (async () => fake) as typeof ClineCore.create });
  const session = await host.open({ ...meta }, (e) => events.push(e));
  const wait = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(check()); };
  session.command({ type: 'prompt', prompt: 'Remember the marker composer-qa.' });
  await wait(() => starts.length === 1);
  session.command({ type: 'configure', selection: { agentId: patch.id, modelId: meta.modelId, reasoningEffort: 'low' } });
  await wait(() => events.some((e) => e.type === 'error' && e.code === 'TURN_RUNNING'));
  emitNative?.({ type: 'ended', payload: { sessionId: 's1', reason: 'completed' } });
  session.command({ type: 'configure', selection: { agentId: patch.id, modelId: meta.modelId, reasoningEffort: 'low' } });
  await wait(() => events.some((e) => e.type === 'model_changed'));
  session.command({ type: 'prompt', prompt: 'What marker did I give you?' });
  await wait(() => starts.length === 2);
  assert.equal(starts[0]!.config?.reasoningEffort, 'high');
  assert.equal(starts[1]!.config?.reasoningEffort, 'low');
  assert.deepEqual(starts[1]!.initialMessages, messages);
  assert.match(String(starts[1]!.config?.systemPrompt), /You are patch/);
  session.close();
});

// a thread whose saved model is a Claude sign-in could not open, and a new pick never landed: the host refused the model
// before the session existed, so the pick's configure had no session (a known limit of #716). Now the thread opens, says
// why once, runs nothing on that model, and a new pick runs the next prompt
test('a refused saved model opens the thread, says why once, runs nothing, and takes a new pick', async () => {
  const starts: Parameters<ClineCore['start']>[0][] = [];
  const events: EngineeringRuntimeEvent[] = [];
  const fake = { subscribe: () => {}, listHistory: async () => [], readMessages: async () => [],
    start: async (input: Parameters<ClineCore['start']>[0]) => { starts.push(input); return { sessionId: `s${starts.length}` }; }, send: async () => {}, stop: async () => {}, dispose: async () => {} } as unknown as ClineCore;
  // the machine has a Claude sign-in and an OpenAI key, and the workspace stores no preference
  const host = createClineEngineeringHost({ ...opts, brainSync: false, resolveCwd: async () => '/repo', resolveBrain: async (m) => ({ modelId: m.modelId!, agent: rex }),
    authProbe: { subActive: async (p) => p === 'anthropic', loginPresent: async (p) => p === 'anthropic', envKey: (p) => (p === 'openai' ? 'sk-openai' : null) },
    fetchImpl: async () => new Response(JSON.stringify({ authMode: null })), createCore: (async () => fake) as typeof ClineCore.create });
  const session = await host.open({ ...meta, modelId: 'claude-opus-5' }, (e) => events.push(e));
  const refusals = () => events.filter((e) => e.type === 'error' && e.code === 'MODEL_REFUSED');
  const wait = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(check()); };
  assert.ok(events.findIndex((e) => e.type === 'ready') < events.findIndex((e) => e.type === 'error'), 'ready first, then the reason');
  assert.equal(refusals().length, 1);
  assert.deepEqual(refusals()[0], { type: 'error', code: 'MODEL_REFUSED', recoverable: true, message: 'Coding with a Claude subscription is off. Pick another model, or add a Claude API key.' });
  session.command({ type: 'prompt', prompt: 'Fix the login bug' });
  await wait(() => refusals().length === 2);
  assert.equal(starts.length, 0, 'nothing runs on the refused model');
  session.command({ type: 'configure', selection: { agentId: rex.id, modelId: 'gpt-5.6-sol', reasoningEffort: 'medium' } });
  await wait(() => events.some((e) => e.type === 'model_changed'));
  session.command({ type: 'prompt', prompt: 'Fix the login bug' });
  await wait(() => starts.length === 1);
  assert.equal(refusals().length, 2, 'the new pick clears the refusal');
  session.close();
});
