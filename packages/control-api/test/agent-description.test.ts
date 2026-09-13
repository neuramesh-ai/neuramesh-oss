// The two agent strings (0110): `description` routes, `brief` instructs.
//
// The split is the convergent design across agent frameworks — Claude Code subagents require a
// `description` meaning "when Claude should delegate to this subagent", separate from the prompt
// body; the OpenAI Agents SDK separates `handoff_description` from `instructions`; A2A says a
// client agent reads the card's description "to determine an agent's suitability". Before this,
// NeuraMesh had one field doing both jobs and the orchestrator was never shown it.
//
// What is tested here is the FLOOR, not the prompt etiquette: who may write each string, that ''
// clears rather than being ignored, and that the A2A card advertises the agent rather than its
// job title.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'a-patch', role: 'developer' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

const DESC = 'Drafts platform-native social copy in the product’s voice. Use for any post, campaign or messaging task.';
const INSTR = 'One concrete claim per post. Lowercase, no hashtags. Never publish — every post is a draft the human approves.';

const cmd = (actor: Actor, body: unknown) =>
  app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

// an agent-issued hire needs its card on file first (requireConfirmCard, 2026-08-18) — the
// fixture posts one exactly as executeHire's real flow does before registering
const hire = async (actor: Actor, extra: Record<string, unknown> = {}) => {
  if (actor.kind === 'agent') {
    await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
      body: JSON.stringify({ workspace: 'ws_acme', channel: 'dev', body: '```nmq\n{"question":"Hire @plume (marketer) into #dev?","options":[{"label":"Hire @plume"},{"label":"Not now"}]}\n```' }),
    });
  }
  return cmd(actor, { type: 'agent.register', workspace: 'ws_acme', machineId: 'm1', name: 'plume', role: 'marketer', channels: ['dev'], ...extra });
};

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('registering an agent carries both strings', () => {
  it('the orchestrator writes description + instructions at hire', async () => {
    const reg = await j(await hire(rex, { description: DESC, brief: INSTR }));
    expect(store.agentStrings(reg.agentId)).toEqual({ description: DESC, brief: INSTR });
  });

  it('a re-register that omits them keeps the stored ones — a rehire never blanks a remit', async () => {
    const reg = await j(await hire(rex, { description: DESC, brief: INSTR }));
    await hire(george); // the daemon's channel re-sync: no strings on the wire
    expect(store.agentStrings(reg.agentId)).toEqual({ description: DESC, brief: INSTR });
  });

  it('the description is capped at 280 — it rides the orchestrator’s context on every staffing turn', async () => {
    const tooLong = await hire(rex, { description: 'x'.repeat(281) });
    expect(tooLong.status).toBe(400);
    expect((await j(tooLong)).error).toBe('invalid command');
    expect((await hire(rex, { description: 'x'.repeat(280) })).status).toBe(200);
  });
});

describe('who may rewrite an agent’s remit', () => {
  it('a human edits both', async () => {
    const reg = await j(await hire(rex, { description: DESC, brief: INSTR }));
    const res = await cmd(george, { type: 'agent.update', agent: reg.agentId, description: 'Owns the sync layer. Route replication work here.', brief: 'Read the sync rules first.' });
    expect(res.status).toBe(200);
    expect(store.agentStrings(reg.agentId)).toEqual({
      description: 'Owns the sync layer. Route replication work here.',
      brief: 'Read the sync rules first.',
    });
  });

  // Staffing authority, the same class as retire: an agent that could rewrite its own remit
  // has none. rex still writes the FIRST draft of both, at agent.register.
  it('the orchestrator cannot — it may edit agents, but not their remit', async () => {
    const reg = await j(await hire(rex, { description: DESC }));
    const denied = await cmd(rex, { type: 'agent.update', agent: reg.agentId, description: 'I am now in charge of everything' });
    expect(denied.status).toBe(403);
    expect((await j(denied)).code).toBe('HUMAN_ONLY');
    expect(store.agentStrings(reg.agentId).description).toBe(DESC);
  });

  it('a worker cannot edit agents at all — the outer gate catches it first', async () => {
    const reg = await j(await hire(rex, { description: DESC }));
    const denied = await cmd(patch, { type: 'agent.update', agent: reg.agentId, description: 'mine now' });
    expect(denied.status).toBe(403);
    expect((await j(denied)).code).toBe('NOT_PERMITTED');
  });

  it('an agent may still be re-seated by the orchestrator — the brain is not the remit', async () => {
    const reg = await j(await hire(rex, { description: DESC }));
    expect((await cmd(rex, { type: 'agent.update', agent: reg.agentId, model: 'claude-opus-4-8' })).status).toBe(200);
  });

  it('an empty string CLEARS rather than being ignored — the UI’s empty field means none', async () => {
    const reg = await j(await hire(rex, { description: DESC, brief: INSTR }));
    await cmd(george, { type: 'agent.update', agent: reg.agentId, brief: '' });
    expect(store.agentStrings(reg.agentId)).toEqual({ description: DESC });
    await cmd(george, { type: 'agent.update', agent: reg.agentId, description: '   ' });
    expect(store.agentStrings(reg.agentId)).toEqual({});
  });
});

describe('the A2A card advertises the agent, not its job title', () => {
  it('publishes the agent’s own description when it has one', async () => {
    const reg = await j(await hire(rex, { description: DESC }));
    const card = await j(await app.request(`/a2a/agents/${reg.agentId}/card.json`));
    expect(card.description).toBe(DESC);
  });

  it('falls back to the role default when it has none — a null description is legal', async () => {
    const reg = await j(await hire(rex));
    const card = await j(await app.request(`/a2a/agents/${reg.agentId}/card.json`));
    expect(card.description).toMatch(/NeuraMesh/);
  });

  it('a human’s edit re-publishes the card', async () => {
    const reg = await j(await hire(rex, { description: DESC }));
    await cmd(george, { type: 'agent.update', agent: reg.agentId, description: 'Owns release readiness. Route deploy-step work here.' });
    const card = await j(await app.request(`/a2a/agents/${reg.agentId}/card.json`));
    expect(card.description).toBe('Owns release readiness. Route deploy-step work here.');
  });
});
