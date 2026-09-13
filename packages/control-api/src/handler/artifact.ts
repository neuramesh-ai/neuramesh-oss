// Artifact commands — extracted from handler.ts (track C1).
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
import { gateArtifactReason, isGateArtifact } from '@neuramesh/shared';




import type { CommandOutcome } from '../handler';

export async function artifactCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'artifact.promote') {
    // library curation is the orchestrator's job — or a human's call
    const mayPromote = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayPromote) throw new DomainError('NOT_PERMITTED', 'only humans or the orchestrator curate the library');
    const result = await store.promoteArtifact(cmd.artifactId, actor.kind === 'agent' ? actor.id : null, (workspace) =>
      createEvent({
        type: 'artifact.promoted',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'artifact', id: cmd.artifactId }),
        workspace,
        payload: {},
      }),
    );
    return { ok: true, workspace: result.workspace } as never;
  }
  if (cmd.type === 'artifact.delete') {
    // agents produce evidence; they do not remove it. Deleting is a human's call — and only for
    // files no gate is standing on (the choice George made: uploads and ordinary deliverables).
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'agents do not delete files — ask a human');
    const art = await store.artifactById(cmd.artifactId);
    if (!art) throw new DomainError('NOT_FOUND', 'file not found');
    if (isGateArtifact({ kind: art.kind, name: art.name })) {
      throw new DomainError('GATE_ARTIFACT', `this one stays — ${gateArtifactReason({ kind: art.kind, name: art.name })}`);
    }
    const result = await store.deleteArtifact(cmd.artifactId, (workspace) =>
      createEvent({
        type: 'artifact.deleted',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'artifact', id: cmd.artifactId }),
        workspace,
        payload: { name: art.name, kind: art.kind },
      }),
    );
    return { ok: true, workspace: result.workspace } as never;
  }
  if (cmd.type === 'artifact.create') {
    // a plain channel artifact — no task attached. The conversational marketing bootstrap
    // drops its docs here; ACL is the channel, exactly like the task-borne library.
    const { id } = await store.createChannelArtifact(
      {
        channelId: cmd.channel, kind: cmd.kind, name: cmd.name,
        inlineContent: cmd.inlineContent, mime: cmd.mime ?? null,
        tags: cmd.tags ?? [],
        createdByKind: actor.kind, createdBy: actor.id,
      },
      (ws) => createEvent({
        type: 'artifact.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, name: cmd.name, kind: cmd.kind },
      }),
    );
    return { ok: true, artifactId: id } as never;
  }
  return undefined;
}
