// Content commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {
  commRulesFrom,
  scrubEmdash,

  createEvent,


  formatAddress,








  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';
import { libraryImage } from '../store/frames';

/** the frame's name as the shelf spells it: a video post names an image on its ROOM's shelf, and a
 *  name the shelf does not hold is refused here, whichever door wrote it (brand-grounding plan §6) */
async function frameName(store: Store, channelId: string | undefined, frame: string | null | undefined): Promise<string | null | undefined> {
  if (frame === undefined) return undefined;
  if (frame === null || frame === '') return null;
  const hit = channelId ? await libraryImage(store, channelId, frame) : null;
  if (!hit) throw new DomainError('NOT_FOUND', `no image named "${frame}" on this room's shelf. list_library names the shelf, and a human can upload a screenshot to the room's Files`);
  return hit.name;
}

/** The house style's teeth for a draft (docs/design/agent-comm-rules-2026-08): a post is the copy a
 *  person publishes, so an agent's body and image brief take the em-dash scrub a message (app.ts)
 *  and a task (createtask.ts) take. Humans are never rewritten. A failed rules read fails open. */
async function styledBy(store: Store, actor: Actor, workspace: () => Promise<string | undefined>): Promise<(text: string) => string> {
  if (actor.kind !== 'agent') return (t) => t;
  const on = await workspace().then((ws) => (ws ? store.getCommRules(ws) : null)).then((r) => commRulesFrom(r).noEmdash).catch(() => false);
  return on ? scrubEmdash : (t) => t;
}

export async function contentCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'content.create') {
    const styled = await styledBy(store, actor, () => store.channelWorkspace(cmd.channel).then((c) => c.workspace));
    const frame = await frameName(store, cmd.channel, cmd.frame);
    const { id } = await store.createContentItem(
      { channelId: cmd.channel, frame, seconds: cmd.seconds ?? null, taskId: cmd.task ?? null, threadId: cmd.thread ?? null, platform: cmd.platform, body: styled(cmd.body), scheduleId: cmd.schedule ?? null, slotAt: cmd.slotAt ?? null, mediaUrl: cmd.mediaUrl ?? null, imageBrief: cmd.imageBrief == null ? null : styled(cmd.imageBrief), script: cmd.script == null ? null : styled(cmd.script), thumb: cmd.thumb ?? null, imageError: cmd.imageError ?? null, createdByKind: actor.kind, createdBy: actor.id },
      (ws) => createEvent({
        type: 'content.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, platform: cmd.platform },
      }),
    );
    return { ok: true, itemId: id } as never;
  }
  if (cmd.type === 'content.attach_media') {
    const m = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,(.+)$/i.exec(cmd.dataUrl);
    if (!m) throw new DomainError('INVALID_INPUT', 'media must be a base64 data: URI');
    const bytes = Buffer.from(m[2]!, 'base64');
    if (!bytes.length) throw new DomainError('INVALID_INPUT', 'media decoded to nothing');
    // Instagram's own ceiling is 8MB; anything past it could never publish anyway (a film is capped the same)
    if (bytes.length > 8_000_000) throw new DomainError('INVALID_INPUT', `media too large (${bytes.length} bytes, max 8MB)`);
    const { id } = await store.attachContentMedia(cmd.item, m[1]!.toLowerCase(), bytes, { kind: actor.kind, id: actor.id }, (ws) => createEvent({
      type: 'content.updated',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'resource', type: 'content', id: cmd.item }),
      workspace: ws,
      payload: { item: cmd.item, media: 'hosted' },
    }));
    return { ok: true, mediaId: id } as never;
  }
  if (cmd.type === 'content.revise') {
    // the marketer revising a draft OR a proposed 'scheduled' slot (never a published post) — a
    // human asking for a change in the thread reaches every unpublished draft. Rewriting a
    // scheduled post's copy unschedules it back to draft (store), so nothing publishes unreviewed.
    if (!cmd.body && cmd.imageBrief === undefined && !cmd.script && cmd.frame === undefined && cmd.seconds === undefined && !cmd.thumb && cmd.imageError === undefined && cmd.videoError === undefined && !cmd.videoMeta && cmd.videoErrorCode === undefined) throw new DomainError('INVALID_INPUT', 'a revision needs a new body, script, frame, length or image brief');
    const media = await store.contentItemMedia(cmd.item);
    const styled = await styledBy(store, actor, async () => media?.workspace);
    const frame = await frameName(store, media?.channel, cmd.frame);
    const { id } = await store.reviseDraft(cmd.item, { frame, seconds: cmd.seconds, body: cmd.body ? styled(cmd.body) : null, imageBrief: cmd.imageBrief ? styled(cmd.imageBrief) : (cmd.imageBrief ?? null), script: cmd.script ? styled(cmd.script) : null, thumb: cmd.thumb ?? null, videoError: cmd.videoError, videoErrorCode: cmd.videoErrorCode, videoMeta: cmd.videoMeta, imageError: cmd.imageError === undefined ? undefined : (cmd.imageError || null) }, (ws) => createEvent({
      type: 'content.updated', source: actorAddress(actor), target: formatAddress({ kind: 'resource', type: 'content', id: cmd.item }), workspace: ws,
      payload: { item: cmd.item, revised: true },
    }));
    return { ok: true, itemId: id } as never;
  }
  // Left behind when this module was first split out: these branches sat in handler.ts
  // beside the FSM tail with no reason other than the order they were written in.

  if (cmd.type === 'content.update' || cmd.type === 'content.delete') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'calendar edits are a human move — agents draft new items instead');
    const mk = (type: 'content.updated' | 'content.deleted') => (ws: string) => createEvent({
      type, source: actorAddress(actor), target: formatAddress({ kind: 'resource', type: 'content', id: cmd.item }), workspace: ws,
      payload: { item: cmd.item },
    });
    const { id } = cmd.type === 'content.update'
      ? await store.updateContentBody(cmd.item, cmd.body, cmd.mediaUrl === undefined ? undefined : (cmd.mediaUrl || null), mk('content.updated'))
      : await store.deleteContentItem(cmd.item, mk('content.deleted'));
    return { ok: true, itemId: id } as never;
  }

  if (cmd.type === 'content.approve' || cmd.type === 'content.unschedule') {
    // agents draft, humans publish (plan §4.7) — structurally, like approve_design
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'content is approved by a human — agents draft, humans publish');
    const approve = cmd.type === 'content.approve';
    const scheduledAt = approve ? (cmd.scheduledAt ?? new Date(Date.now() + 3600_000).toISOString()) : null;
    if (approve && new Date(scheduledAt!).getTime() <= Date.now()) throw new DomainError('INVALID_INPUT', 'scheduledAt must be in the future');
    const { id } = await store.setContentStatus(
      cmd.item,
      approve
        // no explicit time → keep the draft's own future slot (draft-ahead); +1h is the fallback
        ? { status: 'scheduled', scheduledAt: scheduledAt!, approvedBy: actor.id, keepSlot: !cmd.scheduledAt }
        : { status: 'draft', scheduledAt: null, approvedBy: null },
      (ws) => createEvent({
        type: approve ? 'content.approved' : 'content.unscheduled',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'resource', type: 'content', id: cmd.item }),
        workspace: ws,
        payload: approve ? { item: cmd.item, scheduledAt } : { item: cmd.item },
      }),
    );
    return { ok: true, itemId: id } as never;
  }

  return undefined;

}