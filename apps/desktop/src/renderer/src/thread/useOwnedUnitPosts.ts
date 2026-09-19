// THE OWNED UNITS' POST CARDS, IN THEIR CONVERSATION (docs/design/release-drafts-2026-09 §4.5).
//
// A content unit anchored to a conversation (tasks.origin_thread_id, docs/41) never earns a session
// row, so its drafts had no surface but the peek: the release routine's session showed the unit card
// and the brief, and the four posts it existed for sat behind a click. This hook lends the
// conversation the unit's cards through the SAME derivation the task panel runs (postCardsFrom over
// contentByTask), one strip per unit, anchored under the unit's completion note. A lens on the
// rows, never a copy (the UnitCard rule): approve, schedule and request-changes act on the unit's
// own content_items.
//
// Nothing here can double a thread-anchored draft (usePosts.ts): a unit's items carry task_id and a
// conversation's carry thread_id, and the two IPC queries select on exactly those columns
// (main/sync/ipc/content.ts), so the sources are disjoint by construction and there is nothing to
// dedupe. Split out of ConvoThread.tsx, which stands at its size cap.
import { useEffect, useMemo, useState } from 'react';
import { imageCredOf } from '../settings/ConnectionsList';
import { postCardsFrom } from '../marketing/SocialPostCard';
import { nm as nmBridge } from '../bridge/nm';
import type { ContentItemRow } from '../bridge/rows-content';
import type { TaskAllRow } from '../bridge/rows-board';
import type { MessageRow } from '../bridge/rows-rooms';
import type { PostVCard } from './parts';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export interface UnitStrip { unit: TaskAllRow; cards: PostVCard[]; at: string }
/** the armed request-changes pill for a unit's card: the task form of the handle (#1142·c) */
export interface UnitReply { id: string; letter: string; number: number }

/** where a unit's strip sits: a millisecond after its completion note, else after its unit card,
 *  else after the newest row — so the cards always follow the message that announced them */
export function unitStripAt(unit: Pick<TaskAllRow, 'id' | 'number'>, rows: ReadonlyArray<Pick<MessageRow, 'body' | 'created_at'>>): string {
  const anchor = rows.find((m) => m.body.startsWith(`✅ **#${unit.number} is done**`))
    ?? rows.find((m) => m.body.includes(`‹task:${unit.id}›`))
    ?? rows[rows.length - 1];
  return anchor ? new Date(new Date(anchor.created_at).getTime() + 1).toISOString() : new Date(0).toISOString();
}

export function useOwnedUnitPosts(threadId: string, rows: MessageRow[]) {
  // the content units this conversation owns — the UnitCard idiom: watch the synced rows here
  const [units, setUnits] = useState<TaskAllRow[]>([]);
  useEffect(() => {
    if (!nm?.watchTasksAll) return;
    return nm.watchTasksAll((all) => setUnits(all.filter((t) => t.origin_thread_id === threadId && !t.parent_task_id && t.kind === 'content')));
  }, [threadId]);
  const [items, setItems] = useState<Record<string, ContentItemRow[]>>({});
  const [imageReady, setImageReady] = useState<boolean | undefined>(undefined);
  const [replyTo, setReplyTo] = useState<UnitReply | null>(null);
  const [tick, setTick] = useState(0);
  // contentByTask is a query, not a synced watch — poll it as the task panel does (usePosts.ts),
  // and refetch on a new row: the completion note is the cue the drafts just landed
  const unitIds = units.map((u) => u.id).join(',');
  useEffect(() => {
    const ids = unitIds ? unitIds.split(',') : [];
    if (!ids.length) { setItems((prev) => (Object.keys(prev).length ? {} : prev)); return; }
    let dead = false;
    const load = () => {
      for (const id of ids) void nm?.contentByTask(id).then((r) => { if (!dead) setItems((prev) => ({ ...prev, [id]: r.items })); }, () => {});
    };
    load();
    void nm?.credentials().then((r) => { if (!dead) setImageReady(!!imageCredOf(r.credentials ?? [])); }, () => {});
    const iv = setInterval(load, 4000);
    return () => { dead = true; clearInterval(iv); };
  }, [unitIds, tick, rows.length]);
  const strips = useMemo((): UnitStrip[] => units.flatMap((unit) => {
    const cards = postCardsFrom(items[unit.id] ?? [], rows);
    return cards.length ? [{ unit, cards, at: unitStripAt(unit, rows) }] : [];
  }), [units, items, rows]);
  // the armed pill can't outlive its card (a draft published or deleted while you were typing)
  useEffect(() => {
    if (replyTo && !strips.some((s) => s.cards.some((c) => c.item.id === replyTo.id && c.item.status !== 'published'))) setReplyTo(null);
  }, [replyTo, strips]);
  useEffect(() => { setReplyTo(null); }, [threadId]);
  return { strips, imageReady, replyTo, setReplyTo, tick, setTick };
}
