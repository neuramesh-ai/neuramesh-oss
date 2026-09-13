// Setup commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,






  SETUP_FLOWS,

  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function setupCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'setup.step') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'setup is walked by a human');
    const flow = Object.values(SETUP_FLOWS).find((f) => f.id === cmd.flow);
    if (!flow) throw new DomainError('NOT_FOUND', `unknown setup flow ${cmd.flow}`);
    const step = flow.steps.find((s) => s.id === cmd.step);
    if (!step) throw new DomainError('NOT_FOUND', `flow ${flow.id} has no step ${cmd.step}`);
    // the value's SHAPE follows the step: focus is the one array-valued write today, and its
    // members ride the same enum marketing.setup enforces — one validator, not two drifting
    if (step.writes === 'focus' && cmd.value !== undefined) {
      const arr = Array.isArray(cmd.value) ? cmd.value : [cmd.value];
      for (const v of arr) if (!['social', 'content', 'seo', 'email', 'ads'].includes(v)) throw new DomainError('INVALID_INPUT', `not a focus area: ${v}`);
    }
    const patch = step.writes !== undefined && cmd.value !== undefined ? { [step.writes]: cmd.value } : {};
    const { id } = await store.setChannelSetupStep(
      cmd.channel,
      { flowId: flow.id, stepId: step.id, patch },
      (workspace) => createEvent({
        type: 'setup.step',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: { channel: cmd.channel, flow: flow.id, step: step.id, wrote: step.writes ?? null },
      }),
    );
    return { ok: true, channelId: id } as never;
  }
  if (cmd.type === 'setup.backfill') {
    // idempotent by construction (the partial-unique index + the untouched-profile rule), so
    // any actor CALLING it twice is harmless — but creation is a workspace-shaping act, so it
    // rides the same gate channels do: humans and the orchestrator (the daemon's boot actor).
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'setup backfill is run by humans or the orchestrator');
    const made = await store.backfillSetupTasks(cmd.workspace);
    return { ok: true, created: made } as never;
  }
  return undefined;
}
