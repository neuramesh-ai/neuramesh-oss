// The room brief stack — the orchestrator's digests and announcements, pinned at the top of
// a room home (docs/35). Extracted from App.tsx (track A4).
import { IconReply } from '../ui/icons';
import { Md } from '../md/Md';
import { briefPretty, briefPrettyFull, briefSummary, type RoomBrief } from '../room-tabs';
import { replyPreview } from '@neuramesh/shared';
import { timeAgoShort } from '../lib/time';
import { type TaskRefInfo } from '../cards/parse';
import { useState } from 'react';

/**
 * The room brief (docs/35 §4.1): the orchestrator's digests and announcements, pinned above the
 * session list. At rest the newest is one line; the expander stacks the ones behind it, because a
 * one-card slot made eviction into disappearance — a brief has no thread, so it is in neither the
 * session list nor the ⌘Y overlay (§10). Clicking a card replies to it, which ROOTS a session at
 * that message (docs/31 machinery, no new command).
 */
export function BriefStack({ briefs, onOpen, onHistory, taskRef, onOpenTask }: {
  briefs: RoomBrief[];
  onOpen: (b: RoomBrief) => void;
  onHistory: () => void;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false); // the earlier-briefs stack
  // 2026-07-30, George: rest = ONE line; "view" expands the full digest IN PLACE as real
  // markdown — task refs in the theme's pill style, bold, lists — because a digest is a
  // document, not a title. The reply affordances stay exactly as they were: the summary
  // line still arms the composer, and the expanded card carries an explicit Reply.
  const [full, setFull] = useState(false);
  const head = briefs[0];
  if (!head) return null;
  const rest = briefs.slice(1);
  return (
    <div className="briefwrap">
      <div className={`brief${full ? ' open' : ''}`}>
        <span className="k">Channel brief</span>
        {full ? (
          // expanded: a DIV, not a button — the md carries live task pills, and interactive
          // content inside a button is invalid HTML (and unclickable)
          <div className="briefbody full">
            <Md text={briefPrettyFull(head.body)} taskRef={taskRef} onOpenTask={onOpenTask} />
          </div>
        ) : (
          // the DEFAULT click is expand (2026-07-30 round 4) — reading is the common act;
          // replying is the small icon beside the time, same in both states
          <button type="button" className="briefbody" onClick={() => setFull(true)} title="view the full brief">
            {briefSummary(head.body)}
          </button>
        )}
        <button type="button" className="briefreply" title="reply — starts a conversation on this brief" aria-label="Reply to this brief" onClick={() => onOpen(head)}><IconReply s={13} /></button>
        <span className="briefwhen">{timeAgoShort(head.at)}</span>
        <button type="button" className="briefexp" aria-expanded={full} onClick={() => setFull((v) => !v)}>
          {full ? 'collapse' : 'view'}
        </button>
        {rest.length > 0 && (
          <button type="button" className="briefexp" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'hide earlier' : `${rest.length} earlier`}
          </button>
        )}
        <button type="button" className="briefhist" onClick={onHistory}>history <span className="k">⌘Y</span> ›</button>
      </div>
      {open && rest.map((b) => (
        <button key={b.messageId} type="button" className="briefold" onClick={() => onOpen(b)} title="reply — starts a conversation on this brief">
          <span className="briefbody">{briefPretty(replyPreview(b.body, 150))}</span>
          <span className="briefwhen">{timeAgoShort(b.at)}</span>
        </button>
      ))}
    </div>
  );
}
