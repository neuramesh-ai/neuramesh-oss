// Policy commands — extracted from handler.ts (track C1).
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
import { actorAddress, mayConfigurePolicy } from './guards';




import type { CommandOutcome } from '../handler';

export async function policyCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'policy.set') {
    if (!mayConfigurePolicy(actor)) throw new DomainError('NOT_PERMITTED', 'agent policy is configured by humans');
    const event = createEvent({
      type: 'policy.saved',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'policy', id: cmd.id ?? cmd.capability }),
      workspace: cmd.workspace,
      payload: { scope: cmd.scope, capability: cmd.capability, verdict: cmd.verdict },
    });
    const { id } = await store.setPolicy(
      {
        id: cmd.id,
        workspace: cmd.workspace,
        scope: cmd.scope,
        projectId: cmd.projectId ?? null,
        channelId: cmd.channelId ?? null,
        agentId: cmd.agentId ?? null,
        capability: cmd.capability,
        selector: cmd.selector,
        verdict: cmd.verdict,
        rationale: cmd.rationale,
        locked: cmd.locked,
        author: { kind: actor.kind, id: actor.id },
      },
      event,
    );
    return { ok: true, policyId: id } as never;
  }
  if (cmd.type === 'policy.delete') {
    if (!mayConfigurePolicy(actor)) throw new DomainError('NOT_PERMITTED', 'agent policy is configured by humans');
    const event = createEvent({
      type: 'policy.deleted',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'policy', id: cmd.policyId }),
      workspace: cmd.workspace,
      payload: {},
    });
    const { id } = await store.deletePolicy(cmd.policyId, event);
    return { ok: true, policyId: id } as never;
  }
  return undefined;
}
