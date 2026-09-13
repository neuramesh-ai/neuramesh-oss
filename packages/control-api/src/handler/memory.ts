// Memory commands — extracted from handler.ts (track C1).
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

export async function memoryCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'memory.refresh_block') {
    // the sleep-time worker writes as the channel orchestrator; humans may edit
    const mayRefresh = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayRefresh) throw new DomainError('NOT_PERMITTED', 'memory blocks are maintained by the orchestrator or humans');
    const result = await store.refreshMemoryBlock(
      { workspace: cmd.workspace, channel: cmd.channel, kind: cmd.kind, content: cmd.content, basisCount: cmd.basisCount },
      createEvent({
        type: 'memory.block_refreshed',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: cmd.workspace,
        payload: { kind: cmd.kind, basisCount: cmd.basisCount },
      }),
    );
    return { ok: true, blockId: result.id } as never;
  }
  if (cmd.type === 'memory.upsert_fact') {
    const mayWrite = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayWrite) throw new DomainError('NOT_PERMITTED', 'facts are written by the orchestrator or humans');
    const result = await store.upsertFact(
      { workspace: cmd.workspace, channel: cmd.channel, content: cmd.content, basisCount: cmd.basisCount },
      (decision) =>
        createEvent({
          type: 'memory.fact_reconciled',
          source: actorAddress(actor),
          target: formatAddress({ kind: 'channel', slug: cmd.channel }),
          workspace: cmd.workspace,
          payload: { decision },
        }),
    );
    return result as never;
  }
  if (cmd.type === 'memory.record_lesson') {
    // any teammate (worker/reviewer/orchestrator/human) — unlike plain facts —
    // because the corrected agent holds the freshest lesson. The size cap lives in
    // the schema; the kind-scoped reconcile dedupes repeats and supersedes updates.
    if (cmd.taskId && !(await store.getTask(cmd.taskId))) throw new DomainError('NOT_FOUND', `task ${cmd.taskId} not found`);
    const result = await store.upsertFact(
      { workspace: cmd.workspace, channel: cmd.channel, content: cmd.content, basisCount: 0, kind: 'lesson', taskId: cmd.taskId ?? null },
      (decision) =>
        createEvent({
          type: 'memory.lesson_recorded',
          source: actorAddress(actor),
          target: formatAddress({ kind: 'channel', slug: cmd.channel }),
          workspace: cmd.workspace,
          payload: { decision, ...(cmd.taskId ? { taskId: cmd.taskId } : {}) },
        }),
    );
    return result as never;
  }
  if (cmd.type === 'memory.retire_fact') {
    // curation is human/orchestrator-only (mirrors upsert_fact): the teammates who
    // may WRITE a lesson can never end one's validity — enforced here, not prompted.
    const mayRetire = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayRetire) throw new DomainError('NOT_PERMITTED', 'memory is curated by humans or the orchestrator');
    const result = await store.retireFact(cmd.factId, cmd.supersededBy ?? null, (workspace) =>
      createEvent({
        type: 'memory.fact_retired',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'fact', id: cmd.factId }),
        workspace,
        payload: cmd.supersededBy ? { supersededBy: cmd.supersededBy } : {},
      }),
    );
    return { ok: true, ...result } as never;
  }
  return undefined;
}
