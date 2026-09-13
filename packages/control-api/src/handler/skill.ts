// Skill commands — extracted from handler.ts (track C1).
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
import { actorAddress, mayCurate } from './guards';




import type { CommandOutcome } from '../handler';

export async function skillCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'skill.create') {
    // humans + the orchestrator/curator author/curate skills (workers propose)
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'skills are authored by humans, the orchestrator, or the curator');
    if (cmd.scope === 'channel' && !cmd.channel) throw new DomainError('NOT_FOUND', 'channel-scoped skills require a channel');
    const event = createEvent({
      type: 'skill.created',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.name }),
      workspace: cmd.workspace,
      payload: { name: cmd.name, scope: cmd.scope, channel: cmd.channel ?? null },
    });
    const { id } = await store.createSkill(
      { workspace: cmd.workspace, channel: cmd.scope === 'global' ? null : cmd.channel!, name: cmd.name, description: cmd.description, scope: cmd.scope, body: cmd.body, author: { kind: actor.kind, id: actor.id }, packId: cmd.packId ?? null, enabled: cmd.enabled },
      event,
    );
    return { ok: true, skillId: id } as never;
  }
  if (cmd.type === 'skill.update') {
    const mayEdit = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayEdit) throw new DomainError('NOT_PERMITTED', 'skills are edited by humans or the orchestrator');
    const event = createEvent({
      type: 'skill.updated',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.skillId }),
      workspace: '00000000-0000-0000-0000-000000000000', // patched to the skill's workspace in the store
      payload: {},
    });
    const { id } = await store.updateSkill(cmd.skillId, { description: cmd.description, body: cmd.body, scope: cmd.scope }, event);
    return { ok: true, skillId: id } as never;
  }
  if (cmd.type === 'skill.deprecate') {
    const mayEdit = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayEdit) throw new DomainError('NOT_PERMITTED', 'skills are retired by humans or the orchestrator');
    const event = createEvent({
      type: 'skill.deprecated',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.skillId }),
      workspace: '00000000-0000-0000-0000-000000000000',
      payload: {},
    });
    const { id } = await store.deprecateSkill(cmd.skillId, event);
    return { ok: true, skillId: id } as never;
  }
  if (cmd.type === 'skill.propose') {
    // any agent (or human) proposes a draft — the worker's self-learning path
    if (cmd.scope === 'channel' && !cmd.channel) throw new DomainError('NOT_FOUND', 'channel-scoped skills require a channel');
    const event = createEvent({
      type: 'skill.proposed',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.name }),
      workspace: cmd.workspace,
      payload: { name: cmd.name, scope: cmd.scope },
    });
    const { id, updated } = await store.proposeSkill(
      { workspace: cmd.workspace, channel: cmd.scope === 'global' ? null : cmd.channel!, name: cmd.name, description: cmd.description, scope: cmd.scope, body: cmd.body, author: { kind: actor.kind, id: actor.id } },
      event,
    );
    return { ok: true, skillId: id, updated } as never;
  }
  if (cmd.type === 'skill.promote') {
    // the curation gate: orchestrator/curator or human promotes a draft to active
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'drafts are promoted by humans, the orchestrator, or the curator');
    const result = await store.promoteSkill(cmd.skillId, (workspace) =>
      createEvent({
        type: 'skill.promoted',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.skillId }),
        workspace,
        payload: {},
      }),
    );
    return { ok: true, ...result } as never;
  }
  if (cmd.type === 'skill.set_enabled') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator toggle skills');
    const event = createEvent({
      type: 'skill.enabled_set',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.skillId }),
      workspace: '00000000-0000-0000-0000-000000000000',
      payload: { enabled: cmd.enabled },
    });
    const { id } = await store.setSkillEnabled(cmd.skillId, cmd.enabled, event);
    return { ok: true, skillId: id } as never;
  }
  return undefined;
}
