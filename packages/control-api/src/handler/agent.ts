// Agent commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';
import { actorAddress, requireConfirmCard } from './guards';




import type { CommandOutcome } from '../handler';

export async function agentCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'agent.set_status') {
    await store.setAgentStatus(cmd.agentId, cmd.status);
    return { ok: true } as never;
  }
  if (cmd.type === 'agent.register') {
    const mayRegister = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayRegister) throw new DomainError('NOT_PERMITTED', 'agents are registered by humans or the orchestrator');
    // the confirm-first rule is a FLOOR now, not etiquette: an agent-issued hire requires a
    // recent hire card naming this agent — the clicked-accept path arrives answered, the
    // approved-in-their-own-words path arrives open; the SILENT path has no card and is refused
    // (guards.ts requireConfirmCard — 2026-08-18)
    if (actor.kind === 'agent') await requireConfirmCard(store, cmd.workspace, cmd.name, `hiring "${cmd.name}"`);
    const event = createEvent({
      type: 'agent.registered',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'agent', id: cmd.name }),
      workspace: cmd.workspace,
      payload: { role: cmd.role, model: cmd.model, runtime: cmd.runtime, channels: cmd.channels, machineId: cmd.machineId, description: cmd.description ?? null, brief: cmd.brief ?? null },
    });
    const { id } = await store.registerAgent(
      { workspace: cmd.workspace, machineId: cmd.machineId, name: cmd.name, role: cmd.role, model: cmd.model, runtime: cmd.runtime, emoji: cmd.emoji, description: cmd.description, brief: cmd.brief, channels: cmd.channels },
      event,
    );
    return { machineId: cmd.machineId, agentId: id } as never;
  }
  if (cmd.type === 'agent.update') {
    const mayEdit = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayEdit) throw new DomainError('NOT_PERMITTED', 'agents are edited by humans or the orchestrator');
    // A human changing a brain via the editor is a deliberate manual pin (so a later pack-apply
    // skips it) unless the caller sets provenance explicitly — e.g. the apply path stamps 'pack'.
    // Non-human (orchestrator) edits don't auto-pin.
    const modelSource = cmd.modelSource ?? (actor.kind === 'human' && cmd.model !== undefined ? 'manual' : undefined);
    // Who an agent IS is a human's call. The orchestrator writes both strings once, at hire
    // (agent.register), and re-seats brains through this command — but rewriting a live agent's
    // description or instructions is staffing authority, the same class as retire. Enforced here
    // rather than asked for in a prompt: an agent that could edit its own remit has none.
    if ((cmd.description !== undefined || cmd.brief !== undefined) && actor.kind !== 'human') {
      throw new DomainError('HUMAN_ONLY', 'an agent\'s description and instructions are edited by a human');
    }
    const { id } = await store.updateAgent(
      cmd.agent,
      { model: cmd.model, runtime: cmd.runtime, name: cmd.name, description: cmd.description, brief: cmd.brief, modelSource },
      (workspace) => createEvent({
        type: 'agent.updated',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'agent', id: cmd.agent }),
        workspace,
        payload: { model: cmd.model ?? null, runtime: cmd.runtime ?? null, name: cmd.name ?? null, description: cmd.description ?? null, brief: cmd.brief ?? null, modelSource: modelSource ?? null },
      }),
    );
    return { ok: true, agentId: id } as never;
  }
  if (cmd.type === 'agent.retire') {
    // Retirement is a staffing decision — HUMAN-ONLY, like task.accept. Soft by
    // design: the store guard refuses while the agent has open work, and the row
    // (with all its event/task attribution) survives for derived history.
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'agents are retired by a human');
    const { id, name, alreadyRetired } = await store.retireAgent(
      cmd.agent,
      (workspace, agentName, role) => createEvent({
        type: 'agent.retired',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'agent', id: cmd.agent }),
        workspace,
        payload: { name: agentName, role },
      }),
    );
    console.log(`agent_retired id=${id} name=${name} by=${actor.id}${alreadyRetired ? ' (already retired)' : ''}`);
    return { ok: true, agentId: id, alreadyRetired } as never;
  }
  if (cmd.type === 'agent.connect_remote') {
    const mayConnect = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayConnect) throw new DomainError('NOT_PERMITTED', 'external agents are connected by humans or the orchestrator');
    // fetch + validate the external A2A Agent Card (owner-registered = the grant)
    let card: { name?: unknown; url?: unknown; skills?: unknown; ['x-neuramesh']?: { role?: unknown } };
    try {
      const res = await fetch(cmd.cardUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`card URL returned ${res.status}`);
      card = (await res.json()) as typeof card;
    } catch (e) {
      throw new DomainError('INVALID_INPUT', `could not fetch the agent card at ${cmd.cardUrl}: ${e instanceof Error ? e.message : 'fetch failed'}`);
    }
    if (!card || typeof card.name !== 'string' || typeof card.url !== 'string' || !Array.isArray(card.skills)) {
      throw new DomainError('INVALID_INPUT', 'the URL did not return a valid A2A Agent Card (need name, url, skills)');
    }
    const name = card.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'remote-agent';
    const VALID_ROLES = new Set(['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator', 'shipper']);
    const rawRole = card['x-neuramesh']?.role;
    const role = typeof rawRole === 'string' && VALID_ROLES.has(rawRole) ? rawRole : 'developer';
    const event = createEvent({
      type: 'agent.connected_remote',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'agent', id: name }),
      workspace: cmd.workspace,
      payload: { name, endpointUrl: card.url, cardUrl: cmd.cardUrl, channels: cmd.channels },
    });
    const { id } = await store.connectRemoteAgent(
      { workspace: cmd.workspace, channels: cmd.channels, name, role, endpointUrl: card.url, card },
      event,
    );
    return { ok: true, agentId: id, name } as never;
  }
  return undefined;
}
