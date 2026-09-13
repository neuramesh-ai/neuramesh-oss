// Message commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {















  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';

/** the card families whose state lives in the message body — the only bodies revise_card may write */
const CARD_FENCE = /```(?:nmreply)\n/;


import { type Store } from '../store';





import type { CommandOutcome } from '../handler';

export async function messageCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'message.pin') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'only people can pin messages');
    const { id } = await store.pinMessage(cmd.message, cmd.pinned);
    return { ok: true, messageId: id } as never;
  }
  // A card whose state lives in its message body (the ```nmreply block) is rewritten IN PLACE
  // — the two-drafts bug draft_posts/revise_posts already settled, applied to a card family
  // that has no rows of its own. Narrow by construction: only the message's own author may
  // revise it, and the new body must still carry a card fence — so this can never become a
  // general "an agent edits the transcript" door (reply-radar round).
  if (cmd.type === 'message.revise_card') {
    if (!CARD_FENCE.test(cmd.body)) {
      throw new DomainError('INVALID_INPUT', 'a card revision must still carry its card block');
    }
    const { id } = await store.reviseCardMessage(cmd.message, cmd.body, { kind: actor.kind, id: actor.id });
    return { ok: true, messageId: id } as never;
  }
  return undefined;
}
