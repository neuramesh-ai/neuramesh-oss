// Skillpack commands — extracted from handler.ts (track C1).
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

export async function skillpackCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'skillpack.create') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator add skill packs');
    const event = createEvent({
      type: 'skillpack.created',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.name }),
      workspace: cmd.workspace,
      payload: { name: cmd.name, channel: cmd.channel, origin: cmd.origin, sourceUrl: cmd.sourceUrl },
    });
    const { id } = await store.createSkillPack(
      { workspace: cmd.workspace, channel: cmd.channel, name: cmd.name, description: cmd.description, sourceUrl: cmd.sourceUrl, sourceRef: cmd.sourceRef, origin: cmd.origin, author: { kind: actor.kind, id: actor.id } },
      event,
    );
    return { ok: true, packId: id } as never;
  }
  if (cmd.type === 'skillpack.commit') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator commit skill packs');
    const result = await store.commitSkillPack(cmd.packId, { version: cmd.version, skills: cmd.skills }, (workspace) =>
      createEvent({
        type: 'skillpack.committed',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.packId }),
        workspace,
        payload: { count: cmd.skills.length, version: cmd.version },
      }),
    );
    return { ok: true, ...result } as never;
  }
  if (cmd.type === 'skillpack.update') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator update skill packs');
    const event = createEvent({
      type: 'skillpack.updated',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.packId }),
      workspace: '00000000-0000-0000-0000-000000000000',
      payload: { status: cmd.status ?? null, step: cmd.step ?? null },
    });
    const { id } = await store.updateSkillPack(cmd.packId, { status: cmd.status, step: cmd.step, progress: cmd.progress, error: cmd.error, description: cmd.description }, event);
    return { ok: true, packId: id } as never;
  }
  if (cmd.type === 'skillpack.set_enabled') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator toggle skill packs');
    const event = createEvent({
      type: 'skillpack.enabled_set',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.packId }),
      workspace: '00000000-0000-0000-0000-000000000000',
      payload: { enabled: cmd.enabled },
    });
    const { id } = await store.setSkillPackEnabled(cmd.packId, cmd.enabled, event);
    return { ok: true, packId: id } as never;
  }
  if (cmd.type === 'skillpack.remove') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator remove skill packs');
    const event = createEvent({
      type: 'skillpack.removed',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: cmd.packId }),
      workspace: '00000000-0000-0000-0000-000000000000',
      payload: {},
    });
    const { id } = await store.removeSkillPack(cmd.packId, event);
    return { ok: true, packId: id } as never;
  }
  if (cmd.type === 'skillpack.seed_defaults') {
    if (!mayCurate(actor)) throw new DomainError('NOT_PERMITTED', 'only humans, the orchestrator, or the curator seed default packs');
    const event = createEvent({
      type: 'skillpack.committed',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'skill', id: 'bundled-defaults' }),
      workspace: cmd.workspace,
      payload: { channel: cmd.channel },
    });
    const { added } = await store.seedDefaultPacks(cmd.workspace, cmd.channel, event, cmd.kind ?? 'build');
    return { ok: true, added } as never;
  }
  return undefined;
}
