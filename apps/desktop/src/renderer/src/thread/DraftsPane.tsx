// THE DRAFTS TAB (the side-panel round, 2026-10-03, docs/design/side-panel-2026-10 §3.4) — a session's
// drafted posts at full size, in a tab of their own in the side panel. The thread that owns them
// portals this pane in, the way it portals its details into Overview, so every card keeps the
// thread's own doors (request changes arms the thread's composer, a redraw posts the thread's
// marker). "Review · schedule" opens the post's editor IN the pane, not as a modal over the window.
// The transcript keeps one row per delivery (DraftsRow) that names the drafts and opens this tab.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconPost } from '../ui/icons';
import { MK_PLATFORMS } from './DeliveryStrip';
import { RefCard, usePanelShown } from './RefCard';
import { useArrivals } from './useArrivals';
import { PostPreviewModal } from '../marketing/PostPreviewModal';
import type { ContentItemRow } from '../bridge/rows-content';
import type { PanelArrival } from '../shell/arrivals';

/** a card the pane draws: a post at one version, and its letter */
export interface DraftCardLike { key: string; letter: string; superseded: boolean; item: ContentItemRow }

/** the side panel's Drafts tab, as the shell hands it to a thread: where to draw, what to report, how to show it */
export interface DraftsDoor {
  slot: HTMLElement | null;
  /** how many drafts the session holds, and how many wait for your approval */
  onInfo: (info: { count: number; waiting: number }) => void;
  /** a drafts row's door: show the tab */
  onShow: () => void;
}

/**
 * A thread's drafts, reported to the shell while the thread is the session in front: the count
 * the tab wears, the gate it holds, and the drafts that land while you look, which open the tab
 * by themselves as anything else the session makes does. No door (a task in a panel tab) reports nothing.
 */
export function useDraftsTab(cards: readonly DraftCardLike[], posts: readonly ContentItemRow[], key: string, door: DraftsDoor | undefined, onArrive: ((list: PanelArrival[]) => void) | undefined): void {
  const live = cards.filter((c) => !c.superseded);
  const waiting = live.filter((c) => c.item.status === 'draft').length;
  const on = !!door;
  useEffect(() => { if (on) door!.onInfo({ count: live.length, waiting }); }, [on, live.length, waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (on) door!.onInfo({ count: 0, waiting: 0 }); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useArrivals(posts, on ? key : null, (fresh) => { if (fresh.some((p) => p.status === 'draft')) onArrive?.([{ kind: 'drafts', via: 'drafts' }]); });
}

/** every strip's cards once, in transcript order, each with what came with it (a conversation's unit) */
export function stripCards<C extends DraftCardLike, X extends object>(items: ReadonlyArray<{ strip?: readonly C[] | null } & X>, extra: (it: X) => Partial<C>): C[] {
  const seen = new Set<string>();
  const out: C[] = [];
  for (const it of items) for (const c of it.strip ?? []) if (!seen.has(c.key)) { seen.add(c.key); out.push({ ...c, ...extra(it) }); }
  return out;
}

/**
 * The Drafts tab's contents, drawn into the panel's slot: the cards, or the post under review in
 * place of the list. The post's editor sits IN the pane, never as a modal over the window.
 */
export function DraftsTab<C extends DraftCardLike>({ door, cards, renderCard, preview, channelSlug, channelId, projectName, onClose, onChanged }: {
  door: DraftsDoor | undefined;
  cards: readonly C[];
  renderCard: (c: C) => ReactNode;
  preview: ContentItemRow | null;
  channelSlug: string; channelId: string; projectName: string | null;
  onClose: () => void; onChanged: () => void;
}) {
  if (!door?.slot) return null;
  const editor = preview ? <PostPreviewModal inline item={preview} channelSlug={channelSlug} channelId={channelId} projectName={projectName} onClose={onClose} onChanged={onChanged} /> : null;
  return createPortal(<DraftsPane cards={cards} renderCard={renderCard} editor={editor} />, door.slot);
}

const netName = (p: string) => MK_PLATFORMS.find(([k]) => k === p)?.[1] ?? p;

export function DraftsPane<C extends DraftCardLike>({ cards, renderCard, editor }: {
  cards: readonly C[];
  renderCard: (c: C) => ReactNode;
  /** the post open for review and scheduling, drawn in place of the list */
  editor: ReactNode | null;
}) {
  const [net, setNet] = useState<string>('all');
  if (editor) return <div className="draftspane">{editor}</div>;
  // the current version of each post: a replaced version is history the thread row already names
  const live = cards.filter((c) => !c.superseded);
  const nets = [...new Set(live.map((c) => c.item.platform))];
  const shown = net === 'all' || !nets.includes(net) ? live : live.filter((c) => c.item.platform === net);
  return (
    <div className="draftspane">
      <div className="drhd">
        <b>Drafts</b><span className="drct">{live.length}</span>
        <span className="drsp" />
        {nets.length > 1 && (
          <div className="drseg" role="group" aria-label="Show drafts for">
            <button type="button" className={net === 'all' || !nets.includes(net) ? 'on' : ''} onClick={() => setNet('all')}>All</button>
            {nets.map((n) => <button key={n} type="button" className={net === n ? 'on' : ''} onClick={() => setNet(n)}>{netName(n)}</button>)}
          </div>
        )}
      </div>
      <div className="drcards">{shown.map((c) => renderCard(c))}</div>
    </div>
  );
}

/** One delivery of drafts, named in the transcript: its letters, its networks, its gate. */
export function DraftsRow({ cards, onOpen }: { cards: readonly DraftCardLike[]; onOpen: () => void }) {
  const shown = usePanelShown();
  const live = cards.filter((c) => !c.superseded);
  if (!live.length) return null;
  const nets = [...new Set(live.map((c) => netName(c.item.platform)))].join(' · ');
  const waiting = live.filter((c) => c.item.status === 'draft').length;
  const state = live.every((c) => c.item.status === 'published') ? 'posted' : live.some((c) => c.item.status === 'failed') ? 'one did not go out' : 'scheduled';
  return (
    <div className="refrows draftsrow">
      <RefCard glyph={<IconPost s={14} />} tone="mkt" name={live.length === 1 ? `Draft ${live[0]!.letter}` : `${live.length} drafts`}
        meta={waiting ? nets : `${nets} · ${state}`} waits={waiting ? (waiting === 1 ? 'waits for your approval' : 'wait for your approval') : null}
        shown={shown.drafts} chips={<>{live.map((c) => <i key={c.key}>{c.letter}</i>)}</>} onOpen={onOpen} />
    </div>
  );
}
