import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import { EngineeringModelRefused, type EngineeringProviderResolution } from './engineering-provider';
import { EngineeringLanes, laneOf, type EngineeringLane } from './engineering-lanes';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

class FakeLane implements EngineeringLane {
  commands: unknown[] = [];
  closed: boolean | null = null;
  busy = false;
  constructor(readonly name: string) {}
  command(value: unknown): void { this.commands.push(value); }
  async close(keepJournal = false): Promise<void> { this.closed = keepJournal; }
  async flush(): Promise<void> {}
}

const meta = (): EngineeringMachineOpenMeta => ({
  actorId: 'a1', threadId: 't1', repoId: 'r1', repoName: 'repo', branch: 'main', mode: 'act', modelId: 'claude-sonnet-5-5', agentId: 'rex-1', reasoningEffort: 'high',
  permissions: { read: true, edit: true, command: true, web: true, mcp: true }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
});
const cline = (modelId: string): EngineeringProviderResolution => ({ providerId: 'anthropic', modelId, apiKey: 'k' });
const agy = (modelId: string): EngineeringProviderResolution => ({ providerId: 'gemini', modelId, lane: 'agy' });

test('both active lanes preview files without invoking a model or changing the turn', async () => {
  const cwd = await mkdtemp('/tmp/nm-lane-preview-');
  try {
    await writeFile(`${cwd}/README.md`, '# Preview');
    for (const kind of ['cline', 'agy'] as const) {
      const lane = new FakeLane(kind); lane.busy = true;
      const event = await new Promise<EngineeringRuntimeEvent>(resolve => {
        const lanes = new EngineeringLanes(lane, kind, {
          meta: meta(), cwd, current: { provider: cline('test'), modelId: 'test', brainPack: null },
          resolve: async () => { throw new Error('Preview must not resolve a model'); },
          open: async () => { throw new Error('Preview must not open a model'); },
          emit: resolve, log: () => {},
        });
        lanes.command({ type: 'preview_file', requestId: kind, path: 'README.md' });
      });
      assert.deepEqual(event, { type: 'file_preview', requestId: kind, path: 'README.md', content: '# Preview' });
      assert.equal(lane.busy, true);
      assert.deepEqual(lane.commands, []);
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

function setup(start: { lane: FakeLane; provider: EngineeringProviderResolution }, resolve: (modelId: string | null) => Promise<EngineeringProviderResolution>, openFails = false) {
  const events: EngineeringRuntimeEvent[] = [];
  const opened: Array<{ provider: EngineeringProviderResolution; messages: unknown[]; lane: FakeLane }> = [];
  const journal = { brain: { messages: () => [{ role: 'user', content: 'earlier' }] }, record: () => {} };
  let fail = openFails;
  const lanes = new EngineeringLanes(start.lane, laneOf(start.provider), {
    meta: meta(), current: { provider: start.provider, modelId: start.provider.modelId, brainPack: null },
    resolve: async (modelId) => resolve(modelId),
    open: async (provider, _modelId, _brainPack, messages) => {
      if (fail) { fail = false; throw new Error('agy is not installed'); }
      const lane = new FakeLane(laneOf(provider));
      opened.push({ provider, messages, lane });
      return lane;
    },
    conversation: journal as never,
    emit: (event) => events.push(event), log: () => {},
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { lanes, events, opened, settle };
}

test('a prompt and a change that stays on the Cline SDK go straight to the Cline lane', async () => {
  const first = new FakeLane('cline');
  const t = setup({ lane: first, provider: cline('claude-sonnet-5-5') }, async (m) => cline(m!));
  t.lanes.command({ type: 'prompt', prompt: 'hi' });
  t.lanes.command({ type: 'model', modelId: 'claude-opus-5-5' });
  await t.settle();
  assert.deepEqual(first.commands.map((c) => (c as { type: string }).type), ['prompt', 'model']);
  assert.equal(t.opened.length, 0);
});

test('a Gemini sign-in pick moves the thread to the agy lane with the journal still open and the history along', async () => {
  const first = new FakeLane('cline');
  const t = setup({ lane: first, provider: cline('claude-sonnet-5-5') }, async (m) => (m?.startsWith('gemini') ? agy(m) : cline(m!)));
  t.lanes.command({ type: 'configure', selection: { agentId: 'rex-1', modelId: 'gemini-4-argon', reasoningEffort: 'high' } });
  await t.settle();
  assert.equal(first.closed, true, 'the Cline lane closes and keeps the journal');
  assert.equal(t.opened[0]?.provider.lane, 'agy');
  assert.deepEqual(t.opened[0]?.messages, [{ role: 'user', content: 'earlier' }]);
  const changed = t.events.find((e) => e.type === 'model_changed');
  assert.deepEqual(changed, { type: 'model_changed', provider: 'gemini', model: 'gemini-4-argon', modelId: 'gemini-4-argon', brainPack: null, agent: undefined, reasoningEffort: 'high' });
  assert.deepEqual(t.events.filter((e) => e.type === 'status').map((e) => (e as { status: string }).status), ['running', 'idle']);
  t.lanes.command({ type: 'prompt', prompt: 'next' });
  assert.deepEqual(t.opened[0]?.lane.commands, [{ type: 'prompt', prompt: 'next' }]);
  // and back again: the agy lane hands over to a Cline lane
  t.lanes.command({ type: 'model', modelId: 'claude-opus-5-5' });
  await t.settle();
  assert.equal(t.opened[0]?.lane.closed, true);
  assert.equal(t.opened[1]?.provider.providerId, 'anthropic');
});

test('the agy lane ignores a pick it already runs, refuses while busy, and says why a pick is refused', async () => {
  const first = new FakeLane('agy');
  const t = setup({ lane: first, provider: agy('gemini-4-argon') }, async (m) => {
    if (m === 'gemini-3.1-flash-lite') throw new EngineeringModelRefused('Gemini 3.1 Flash Lite does not run on a Google sign-in.');
    return agy(m!);
  });
  t.lanes.command({ type: 'model', modelId: 'gemini-4-argon' });
  await t.settle();
  assert.equal(t.opened.length, 0);
  first.busy = true;
  t.lanes.command({ type: 'model', modelId: 'gemini-3.8-flash' });
  await t.settle();
  assert.equal((t.events.at(-1) as { code?: string }).code, 'TURN_RUNNING');
  first.busy = false;
  t.lanes.command({ type: 'model', modelId: 'gemini-3.1-flash-lite' });
  await t.settle();
  assert.match((t.events.at(-1) as { message: string }).message, /does not run on a Google sign-in/);
  assert.equal(first.closed, null, 'a refused pick leaves the lane open');
});

test('a lane that fails to open puts the old model back, so the thread keeps working', async () => {
  const first = new FakeLane('cline');
  const t = setup({ lane: first, provider: cline('claude-sonnet-5-5') }, async (m) => (m?.startsWith('gemini') ? agy(m) : cline(m!)), true);
  t.lanes.command({ type: 'model', modelId: 'gemini-4-argon' });
  await t.settle();
  assert.equal(t.opened.length, 1);
  assert.equal(t.opened[0]?.provider.modelId, 'claude-sonnet-5-5');
  assert.match((t.events.find((e) => e.type === 'error') as { message: string }).message, /agy is not installed/);
  assert.equal(t.events.some((e) => e.type === 'model_changed'), false);
  t.lanes.command({ type: 'prompt', prompt: 'still here' });
  assert.deepEqual(t.opened[0]?.lane.commands, [{ type: 'prompt', prompt: 'still here' }]);
});
