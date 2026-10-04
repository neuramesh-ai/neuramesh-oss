// The reply queue's three verbs (docs/design/models-and-replies-2026-10/plan.md §2). A person queues
// the rows of a reply card at a gap; the server reads the rows off the card itself, so a client never
// names a draft or a link, and every row belongs to the member who queued it. NeuraMesh posts none of
// them: the minute cron reminds, and the reminder opens X's reply box with the text in it.
import { parseReplies, queueTimes, replyOpenUrl, type Actor, type ReplyItem } from '@neuramesh/shared';
import type { Command } from '../commands';
import { actorInWorkspace } from '../credits';
import { DomainError } from '../errors';
import type { Store } from '../store';
import type { ReplyStore } from '../store/replies';
import type { CommandOutcome } from '../handler';

/** the earliest a queue may start (a few seconds of clock skew), and the latest (a week out) */
const SKEW_MS = 60_000;
const HORIZON_MS = 7 * 24 * 3600_000;

/** the rows a queue writes: the card's own drafts and links, one gap apart from `startMs` */
export function queueRows(items: ReplyItem[], startMs: number, gapMin: 5 | 8 | 12 | 20) {
  const times = queueTimes(items.length, startMs, gapMin);
  return items.map((it, i) => ({
    letter: it.letter, platform: it.target.platform, handle: it.target.handle, draft: it.draft,
    openUrl: replyOpenUrl(it), dueAt: new Date(times[i]!).toISOString(),
  }));
}

function repliesOf(store: Store): ReplyStore {
  if (!store.replies) throw new DomainError('INVALID_INPUT', 'this server keeps no reply queue');
  return store.replies;
}

export async function replyCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type !== 'reply.queue' && cmd.type !== 'reply.mark' && cmd.type !== 'reply.clear') return undefined;
  if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'a person queues and marks their own replies');
  const replies = repliesOf(store);
  if (cmd.type === 'reply.queue') {
    const card = await replies.cardMessage(cmd.message);
    if (!card) throw new DomainError('NOT_FOUND', 'that reply card does not exist');
    if (!(await actorInWorkspace(store, actor, card.workspaceId))) throw new DomainError('NOT_PERMITTED', 'not your workspace');
    const data = parseReplies(card.body);
    if (!data) throw new DomainError('INVALID_INPUT', 'that message carries no reply card');
    const want = new Set(cmd.letters.map((l) => l.trim().toUpperCase()));
    const items = data.items.filter((i) => want.has(i.letter));
    if (!items.length) throw new DomainError('INVALID_INPUT', 'no row on the card has those letters');
    const now = Date.now();
    const start = Date.parse(cmd.startAt);
    if (start > now + HORIZON_MS) throw new DomainError('INVALID_INPUT', 'a queue starts within a week');
    const rows = queueRows(items, Math.max(start, now - SKEW_MS), cmd.gapMin);
    const queued = await replies.queue({ workspaceId: card.workspaceId, threadId: card.threadId, messageId: cmd.message, memberId: actor.id, rows });
    return { ok: true, queued } as never;
  }
  if (cmd.type === 'reply.mark') {
    if (!(await replies.mark(cmd.reminder, actor.id, cmd.state))) throw new DomainError('NOT_FOUND', 'that reply is not in your queue');
    return { ok: true } as never;
  }
  const cleared = await replies.clear(cmd.message, actor.id);
  return { ok: true, cleared } as never;
}
