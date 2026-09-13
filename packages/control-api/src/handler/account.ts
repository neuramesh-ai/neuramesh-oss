// Account commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {















  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';





import type { CommandOutcome } from '../handler';

export async function accountCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'account.delete') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'accounts are deleted by their owner');
    await store.deleteAccount(actor.id);
    console.log(`account_deleted id=${actor.id}`);
    return { ok: true } as never;
  }
  return undefined;
}
