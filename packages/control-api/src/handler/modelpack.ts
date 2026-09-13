// Modelpack commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,











  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function modelpackCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  // Custom brains (user-authored model packs): human-only like every workspace setting.
  // save = create (server mints the id) or update; delete resets the active pointer in-store.
  if (cmd.type === 'modelpack.save') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'team brains are managed by humans');
    const { id } = await store.saveModelPack(
      { workspace: cmd.workspace, packId: cmd.packId, name: cmd.name, roles: cmd.roles, createdBy: actor.id },
      (workspace) => createEvent({
        type: 'modelpack.saved',
        source: actorAddress(actor),
        target: `resource/workspace/${workspace}`,
        workspace,
        payload: { packId: cmd.packId ?? null, name: cmd.name },
      }),
    );
    return { ok: true, packId: id } as never;
  }
  if (cmd.type === 'modelpack.delete') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'team brains are managed by humans');
    const { id } = await store.deleteModelPack(cmd.workspace, cmd.packId, (workspace) => createEvent({
      type: 'modelpack.removed',
      source: actorAddress(actor),
      target: `resource/workspace/${workspace}`,
      workspace,
      payload: { packId: cmd.packId },
    }));
    return { ok: true, packId: id } as never;
  }
  return undefined;
}
