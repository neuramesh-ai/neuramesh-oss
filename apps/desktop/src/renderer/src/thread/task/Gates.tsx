// The task panel's gate rows (docs/25) — design approval, the design hand-off card, the
// artifact strip, and the blocked bar.
//
// docs/25: exactly ONE contextual gate docks above the composer. Feedback bounces through the
// ARMED reply box rather than a second button, which is why these rows set composerMode instead
// of sending anything themselves. Split out of thread/TaskThread.tsx.

import { nm as nmBridge } from '../../bridge/nm';
import { DesignHandoffCard } from '../../design/DesignHandoffCard';
import { previewType } from '../../views/docpreview';
import { unblockNote } from '@neuramesh/shared';
import type { ArtifactUI, TaskRow } from '../../bridge/rows-board';
import type { AgentRow } from '../../bridge/rows-crew';

const nm = nmBridge;

type ComposerMode = 'request_changes' | 'revise_design' | 'revise_ship_plan' | 'revise_plan' | null;

export function useTaskGates(d: {
  task: TaskRow;
  channelId: string;
  arts: ArtifactUI[];
  busy: boolean;
  actErr: string;
  act: (type: string, fb?: string, opts?: { silentThread?: boolean }) => Promise<void>;
  assignee: string | null;
  channelArchitect: AgentRow | null | undefined;
  composerMode: ComposerMode;
  setComposerMode: React.Dispatch<React.SetStateAction<ComposerMode>>;
  onPreview: (name?: string) => void;
  studioOpen: boolean;
  roundMockups: ArtifactUI[];
  latestRound: number | null;
  openDesign: (name?: string) => void;
  designProvider: string | null;
  claudeDesignUrl: string | null;
}) {
  const { task, channelId, arts, busy, actErr, act, assignee, channelArchitect, composerMode, setComposerMode, onPreview, studioOpen, roundMockups, latestRound, openDesign, designProvider, claudeDesignUrl } = d;
// The plan gate moved INTO the thread (2026-08-19, founder direction): the ‹plan:vN› message
// renders PlanReviewCard — question-card pills over an embedded document canvas — so this hook
// docks nothing for plan_review. Approve/revise live on the card; the composer arms from it.


// Design gate action bar (design_review): Review leads — approving unseen mockups
// is rubber-stamping (the docs/12 §3.3 inversion, applied harder for visuals);
// Approve stays one click away for a re-review. Feedback bounces to the designer
// through the armed reply box (the Design-changes pill scopes the send).
// docs/25: exactly ONE contextual gate. While the studio is open it HOLDS the design
// approval (Approve + Redraw live at its foot), so the thread's dock stays empty —
// two Approve buttons on one screen would be the bug.
const designActions = task.state === 'design_review' && !studioOpen ? (
  <>
    <div className="tactions">
      <button className="btn primary" disabled={busy} onClick={() => openDesign()}>Review design</button>
      <button className="btn" disabled={busy} onClick={() => void act('task.approve_design')} title="approve the mockups — the architect plans against them">✓ Approve design</button>
      <button
        className="btn"
        disabled={busy}
        aria-pressed={composerMode === 'revise_design'}
        onClick={() => { if (composerMode === 'revise_design') setComposerMode(null); else setComposerMode('revise_design'); }}
        title="send the mockups back to the designer — arms the reply box below"
      >Request changes</button>
      {actErr && <span className="acterr">{actErr}</span>}
    </div>
  </>
) : null;

// The card renders ONLY once a round is ready. While designers are still drawing there is
// nothing to look at, and a placeholder pinned mid-thread is what made the transcript feel
// like it jumped: the live activity stream already says work is happening.
const designHandoff = roundMockups.length > 0 ? (
  <DesignHandoffCard
    key={`design-handoff-${latestRound || 1}`}
    provider={designProvider === 'claude-design' ? 'claude-design' : 'iris'}
    taskState={task.state}
    mockups={roundMockups}
    round={latestRound || 1}
    externalUrl={claudeDesignUrl}
    architectName={channelArchitect?.name ?? null}
    designerName={assignee}
    onOpen={openDesign}
  />
) : null;

// validation-artifact thumbnails — a horizontally scrollable strip leading the artifacts
// drawer, so screenshots are one glance (click → full preview at that artifact) instead of
// a hunt through the thread. Images lead; other kinds show a compact kind card.
const artStrip = arts.length > 0 ? (
  <div className="artstrip">
    {[...arts]
      .map((a) => ({ a, t: previewType(a.name, a.kind, a.inline_content ?? '') }))
      .sort((x, y) => ((x.t === 'image' ? 0 : 1) - (y.t === 'image' ? 0 : 1)) || (x.a.created_at < y.a.created_at ? 1 : -1))
      .map(({ a, t }) => {
        const c = a.inline_content ?? '';
        const src = t === 'image' && c ? (c.startsWith('data:') ? c : `data:image/svg+xml;utf8,${encodeURIComponent(c)}`) : null;
        return (
          <button key={a.id} className="artthumb" title={`${a.name} — click to preview`} onClick={() => onPreview(a.name)}>
            {src ? <img src={src} alt={a.name} /> : <span className="artthumbkind">{t}</span>}
            <span className="artthumbname">{a.name}</span>
          </button>
        );
      })}
  </div>
) : null;

const blockedActions = task.state === 'blocked' ? (
  <div className="tactions">
    {/* Unblock leaves a MARKER in the thread — it is the anchor the daemon's retry budget
        counts from (execpolicy), and without it the budget was a latch: once a task had hit
        the block threshold, every later attempt blocked on its first try and Unblock put it
        straight back. It also means the record shows the human intervened, which it did not
        before — a block with no visible unblock is why the loop looked like a spinner. */}
    <button className="btn" disabled={busy} onClick={() => void (async () => {
      await act('task.unblock');
      await nm?.sendThread(task.id, channelId, unblockNote(task.number)).catch(() => {});
    })()}>Unblock</button>
    {actErr && <span className="acterr">{actErr}</span>}
  </div>
) : null;
  return { designActions, designHandoff, artStrip, blockedActions };
}
