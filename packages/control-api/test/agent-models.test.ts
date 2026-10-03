// A person's model for each agent (0148, docs/design/models-and-replies-2026-10/plan.md §4). What must
// hold: the pick lands on the ACTOR's own row and nobody else's; null clears it; a level rides only a
// model that takes one; an agent can never set a pick; an agent of another workspace, a retired agent
// and an unknown model are refused.
import { createEvent, formatAddress, STARTER_MODEL, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const ana: Actor = { kind: 'human', id: 'ana' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let rex = '';
let plume = '';
const hdr = (actor: Actor) => ({ 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) });
const send = (actor: Actor, body: unknown) => app.request('/v1/commands', { method: 'POST', headers: hdr(actor), body: JSON.stringify(body) });
const ev = (by: string) => createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: by }), target: 'resource/workspace/ws_acme', workspace: 'ws_acme', payload: {} });
const agentIn = async (workspace: string, name: string, role: string) =>
  (await store.registerAgent({ workspace, machineId: 'm1', name, role, model: 'claude-sonnet-5', runtime: 'claude-code', channels: [] }, ev('george'))).id;

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  const members = store as unknown as { addMember(workspace: string, userId: string): void };
  members.addMember('ws_acme', 'george');
  members.addMember('ws_acme', 'ana');
  rex = await agentIn('ws_acme', 'rex', 'orchestrator');
  plume = await agentIn('ws_acme', 'plume', 'marketer');
});

describe('member.set_agent_model', () => {
  it('lands on the actor\'s own row, with the level, and the other member keeps none', async () => {
    const r = await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: 'claude-opus-5', thinking: 'high' });
    expect(r.status).toBe(200);
    expect(await store.agentModels.get('ws_acme', 'george')).toEqual({ [rex]: { model: 'claude-opus-5', thinking: 'high' } });
    expect(await store.agentModels.get('ws_acme', 'ana')).toEqual({});
    // two agents, two picks, one row
    await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: plume, model: 'gpt-5.6-terra', thinking: 'low' });
    expect(Object.keys(await store.agentModels.get('ws_acme', 'george')).sort()).toEqual([plume, rex].sort());
  });

  it('a field naming another member is ignored: the row written is always the actor\'s', async () => {
    await send(ana, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: 'claude-haiku-4-5', member: 'george', user: 'george' });
    expect(await store.agentModels.get('ws_acme', 'george')).toEqual({});
    expect((await store.agentModels.get('ws_acme', 'ana'))[rex]?.model).toBe('claude-haiku-4-5');
  });

  it('drops a level the model does not take, and null clears the pick', async () => {
    await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: STARTER_MODEL, thinking: 'high' });
    expect((await store.agentModels.get('ws_acme', 'george'))[rex]).toEqual({ model: STARTER_MODEL });
    await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: 'gemini-3.1-flash-lite', thinking: 'medium' });
    expect((await store.agentModels.get('ws_acme', 'george'))[rex]).toEqual({ model: 'gemini-3.1-flash-lite' });
    const r = await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: null });
    expect(r.status).toBe(200);
    expect(await store.agentModels.get('ws_acme', 'george')).toEqual({});
  });

  it('an agent can never set a pick', async () => {
    const r = await send({ kind: 'agent', id: rex, role: 'orchestrator' }, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: 'claude-opus-5' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { code?: string }).code).toBe('HUMAN_ONLY');
    expect(await store.agentModels.get('ws_acme', rex)).toEqual({});
  });

  it('refuses an agent of another workspace, a retired agent and an unknown model', async () => {
    const foreign = await agentIn('ws_other', 'rex', 'orchestrator');
    expect((await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: foreign, model: 'claude-opus-5' })).status).toBe(404);
    await store.retireAgent(plume, () => ev('george'));
    expect((await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: plume, model: 'claude-opus-5' })).status).toBe(404);
    expect((await send(george, { type: 'member.set_agent_model', workspace: 'ws_acme', agent: rex, model: 'claude-opus-99' })).status).toBe(400);
    expect(await store.agentModels.get('ws_acme', 'george')).toEqual({});
  });
});

describe('the house brain flag on /v1/usage (brain.serves)', () => {
  it('is true on a hosted server with the key, false on the local stack or without the key', async () => {
    const { houseBrainServes } = await import('../src/credits');
    const env = { local: process.env['NM_LOCAL'], key: process.env['STARTER_GOOGLE_API_KEY'] };
    try {
      delete process.env['NM_LOCAL']; process.env['STARTER_GOOGLE_API_KEY'] = 'k';
      expect(houseBrainServes()).toBe(true);
      process.env['NM_LOCAL'] = '1';
      expect(houseBrainServes()).toBe(false);
      delete process.env['NM_LOCAL']; delete process.env['STARTER_GOOGLE_API_KEY'];
      expect(houseBrainServes()).toBe(false);
    } finally {
      if (env.local === undefined) delete process.env['NM_LOCAL']; else process.env['NM_LOCAL'] = env.local;
      if (env.key === undefined) delete process.env['STARTER_GOOGLE_API_KEY']; else process.env['STARTER_GOOGLE_API_KEY'] = env.key;
    }
  });
});
