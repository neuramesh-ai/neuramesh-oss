// Whiteboard commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,




  parseWhiteboardScene,
  whiteboardSource,
} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function whiteboardCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'whiteboard.create') {
    // the AGENT door (docs/38): a board born from exactly one generation source. Humans create
    // boards through the local-first row path; no actor gate here — the thread's channel is the
    // filing, exactly like artifact.create above.
    const kind = cmd.mermaid ? 'mermaid' : cmd.elements ? 'elements' : null;
    if (!kind || (cmd.mermaid && cmd.elements)) {
      throw new DomainError('INVALID_INPUT', 'provide exactly one of mermaid or elements');
    }
    if (cmd.elements) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cmd.elements);
      } catch {
        throw new DomainError('INVALID_INPUT', 'elements must be a JSON array of Excalidraw skeleton elements');
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new DomainError('INVALID_INPUT', 'elements must be a non-empty JSON array of Excalidraw skeleton elements');
      }
    }
    const { id, workspace } = await store.createWhiteboard(
      {
        channelId: cmd.channel,
        threadId: cmd.threadId ?? null,
        taskId: cmd.taskId ?? null,
        title: cmd.title,
        source: whiteboardSource(kind, (cmd.mermaid ?? cmd.elements)!),
        createdByKind: actor.kind,
        createdBy: actor.id,
      },
      (ws) => createEvent({
        type: 'whiteboard.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { title: cmd.title, source: kind },
      }),
    );
    return { ok: true, whiteboardId: id, workspace } as never;
  }
  if (cmd.type === 'whiteboard.update') {
    // three shapes over one strict rev guard: a new SOURCE (agent edit), MATERIALIZE (the first
    // desktop to render realizes source → scene + snapshot, clearSource), or a TITLE rename.
    const sourceKind = cmd.mermaid ? 'mermaid' : cmd.elements ? 'elements' : null;
    if (cmd.mermaid && cmd.elements) throw new DomainError('INVALID_INPUT', 'provide at most one of mermaid or elements');
    if (sourceKind && cmd.clearSource) throw new DomainError('INVALID_INPUT', 'a new source and clearSource cannot ride one update');
    if (cmd.clearSource && !cmd.scene) throw new DomainError('INVALID_INPUT', 'materialize carries the realized scene');
    if (cmd.scene && !parseWhiteboardScene(cmd.scene)) {
      throw new DomainError('INVALID_INPUT', 'scene must be JSON with an elements array');
    }
    if (cmd.elements) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(cmd.elements);
      } catch {
        throw new DomainError('INVALID_INPUT', 'elements must be a JSON array of Excalidraw skeleton elements');
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new DomainError('INVALID_INPUT', 'elements must be a non-empty JSON array of Excalidraw skeleton elements');
      }
    }
    if (!sourceKind && !cmd.scene && cmd.title === undefined) {
      throw new DomainError('INVALID_INPUT', 'nothing to update — carry a title, a source, or a scene');
    }
    const { rev } = await store.updateWhiteboard(
      {
        id: cmd.whiteboardId,
        baseRev: cmd.baseRev,
        title: cmd.title,
        source: sourceKind ? whiteboardSource(sourceKind, (cmd.mermaid ?? cmd.elements)!) : undefined,
        scene: cmd.scene,
        snapshotSvg: cmd.snapshotSvg,
        clearSource: cmd.clearSource,
        updatedByKind: actor.kind,
        updatedBy: actor.id,
      },
      (ws) => createEvent({
        type: 'whiteboard.updated',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'whiteboard', id: cmd.whiteboardId }),
        workspace: ws,
        payload: { rev: cmd.baseRev + 1, materialized: !!cmd.clearSource, ...(sourceKind ? { source: sourceKind } : {}) },
      }),
    );
    return { ok: true, whiteboardId: cmd.whiteboardId, rev } as never;
  }
  return undefined;
}
