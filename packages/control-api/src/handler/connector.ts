// Connector commands — extracted from handler.ts (track C1).
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
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function connectorCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'connector.disconnect') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'connectors are managed by a human');
    const { id } = await store.revokeConnector(
      cmd.connector,
      (ws) => createEvent({
        type: 'connector.revoked',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'connector', id: cmd.connector }),
        workspace: ws,
        payload: { connector: cmd.connector },
      }),
    );
    return { ok: true, connectorId: id } as never;
  }
  return undefined;
}
