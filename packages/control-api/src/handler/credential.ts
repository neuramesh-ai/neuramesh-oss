// Credential commands — extracted from handler.ts (track C1).
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

export async function credentialCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'credential.set') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'credentials are managed by humans');
    if (cmd.scope === 'agent' && !cmd.agentId) throw new DomainError('NOT_FOUND', 'agent scope requires agentId');
    if (cmd.authMode === 'apikey' && !cmd.token) throw new DomainError('NOT_PERMITTED', 'an API key is required for apikey mode');
    const event = createEvent({
      type: 'credential.updated',
      source: actorAddress(actor),
      target: cmd.scope === 'agent' ? formatAddress({ kind: 'agent', id: cmd.agentId! }) : `resource/credential/${cmd.provider}`,
      workspace: cmd.workspace,
      // token NEVER enters the events log; auth_mode is non-secret metadata
      payload: { provider: cmd.provider, scope: cmd.scope, authMode: cmd.authMode },
    });
    await store.setCredential(
      {
        workspace: cmd.workspace,
        provider: cmd.provider,
        scope: cmd.scope,
        agentId: cmd.agentId ?? null,
        // apikey: the key. subscription: usually no token, but a supplied one is kept as the
        // failover key (used only when the subscription is down and Auto failover is on).
        token: cmd.token ?? null,
        authMode: cmd.authMode,
        setBy: actor.id,
      },
      event,
    );
    return { ok: true } as never;
  }
  return undefined;
}
