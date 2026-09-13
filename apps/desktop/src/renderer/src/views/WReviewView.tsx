// The whiteboard review view (docs/38) — a scene, read-only, pinned to a task.
// Extracted from App.tsx (track A2).
import { ALERT_META, parsePlanAlert, splitPlanBlocks, themedMockupDoc } from '../design/plans';
import { DiffView } from './docpreview';
import { Md } from '../md/Md';
import { addComment, deleteComment, diffRounds, editComment, type ReviewBinding, type ReviewComment, type ReviewMode, type ReviewVerdict } from '../review';
import { highlightCode } from '../lib/highlight';
import { type WTab } from '../wtabs';
import { useMemo, useState } from 'react';

/**
 * The review tab (mockups/review-in-tab.html, docs/36 §13) — ONE surface for every artifact that
 * needs a verdict, bound to `{ artifact, gate, verdict[] }` from `review.ts`.
 *
 * There is deliberately no `PlanReviewView` beside this, and no `ShipPlanReviewView`, and no
 * `DesignReviewView`. An implementation plan, a release plan and a design round differ here only
 * in the data the model hands over: the kind chip and the mode segment come from the ARTIFACT, the
 * human-only badge and the button wording come from the GATE, and the buttons are the VERDICTS. If
 * a kind ever needs its own component, the model was wrong and the fix belongs in `review.ts`.
 *
 * Two things it does that the retired `.apvwrap` overlay could not:
 *  - a SUPERSEDED round opens without buttons (the overlay offered Approve on any round the task's
 *    state allowed, so a stale link was a second live gate);
 *  - the comment batch is owned by the tab, not by this component (ruling 4), so switching tabs
 *    mid-batch cannot lose it.
 */
export function WReviewView({ tab, binding, content, comments, mode, onComments, onMode, onSpend, onOpenLatest, onClose, busy, error }: {
  tab: WTab; binding: ReviewBinding; content: string;
  comments: ReviewComment[]; mode: ReviewMode;
  onComments: (next: ReviewComment[]) => void;
  onMode: (m: ReviewMode) => void;
  onSpend: (v: ReviewVerdict, comments: ReviewComment[]) => void;
  onOpenLatest: (name: string) => void;
  onClose: () => void;
  busy: boolean; error: string;
}) {
  const open = binding.gate.state === 'open';
  const blocks = useMemo(() => (binding.modes.includes('preview') ? splitPlanBlocks(content) : []), [content, binding.modes]);
  const [active, setActive] = useState<{ block: number; quote?: string; editId?: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [float, setFloat] = useState<{ block: number; quote: string; x: number; y: number } | null>(null);
  const count = comments.length;

  const openComment = (block: number, quote?: string, editId?: number) => {
    setFloat(null);
    setActive({ block, quote, editId });
    setDraft(editId ? (comments.find((c) => c.id === editId)?.text ?? '') : '');
    window.getSelection()?.removeAllRanges();
  };
  const saveComment = () => {
    if (!active) return;
    onComments(active.editId ? editComment(comments, active.editId, draft) : addComment(comments, { block: active.block, quote: active.quote, text: draft }));
    setActive(null); setDraft('');
  };
  // selection → a floating Comment button anchored at the highlight (instant, no delay)
  const onMouseUp = () => {
    if (!open) return;
    const sel = window.getSelection();
    const q = sel?.toString().trim() ?? '';
    if (!sel || sel.isCollapsed || !q) { setFloat(null); return; }
    const node = sel.getRangeAt(0).startContainer;
    const el = (node instanceof Element ? node : node.parentElement)?.closest('[data-pblock]') as HTMLElement | null;
    if (!el) { setFloat(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setFloat({ block: Number(el.dataset.pblock), quote: q, x: r.left + r.width / 2, y: r.top });
  };
  // A verdict that needs a batch and has none opens the note box rather than sitting inert. It is
  // also the ONLY way to comment on a rendered artifact — a design round lives in an iframe, whose
  // selection this document cannot reach — so the same act covers both without a second affordance.
  const spend = (v: ReviewVerdict) => {
    if (v.needsComments && !count) { openComment(0); return; }
    onSpend(v, comments);
  };
  const trunc = (s: string) => (s.length > 90 ? s.slice(0, 90) + '…' : s);
  const editor = (
    <div className="wrveditor">
      {active?.quote && <div className="wrvquote">“{trunc(active.quote)}”</div>}
      <textarea autoFocus value={draft} rows={3} placeholder={`what should change about ${binding.gate.subject}?`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveComment();
          if (e.key === 'Escape') { e.stopPropagation(); setActive(null); setDraft(''); }
        }} />
      <div className="wrveditact">
        <button className="btn primary" onClick={saveComment}>{active?.editId ? 'Save' : 'Comment'}</button>
        <button className="btn" onClick={() => { setActive(null); setDraft(''); }}>Cancel</button>
      </div>
    </div>
  );
  const notes = (i: number) => (
    <>
      {comments.filter((c) => c.block === i).map((c) => (
        <div key={c.id} className="wrvnote">
          {c.quote && <div className="wrvquote">“{trunc(c.quote)}”</div>}
          <div className="wrvnotetext">{c.text}</div>
          {open && (
            <div className="wrvnoteact">
              <button title="edit" onClick={() => openComment(i, c.quote, c.id)}>✎</button>
              <button title="delete" onClick={() => onComments(deleteComment(comments, c.id))}>🗑</button>
            </div>
          )}
        </div>
      ))}
      {active?.block === i && editor}
    </>
  );
  return (
    <>
      <div className="wrvhead">
        <span className={`wrvkind ${binding.kind}`}>{binding.kind === 'ship' ? '⚓' : '◪'} {binding.label}</span>
        {tab.subtitle && <span className="wrvtask">{tab.subtitle}</span>}
        <b className="wrvname">{binding.name}</b>
        {binding.version > 0 && <span className="wrvver">· v{binding.version}</span>}
        {binding.latest && <span className="wrvlatest">latest</span>}
        <div className="wrvseg" role="group" aria-label="Render mode">
          {binding.modes.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => onMode(m)}>
              {m === 'diff' ? binding.diffLabel : m === 'rendered' ? 'Rendered' : m === 'source' ? 'Source' : 'Preview'}
            </button>
          ))}
        </div>
      </div>
      <div className="wrvdoc" onMouseUp={onMouseUp} onMouseDownCapture={() => float && setFloat(null)}>
        {mode === 'preview' && (
          <div className="wrvdocinner">
            {blocks.map((b, i) => {
              const cs = comments.filter((c) => c.block === i);
              const alert = parsePlanAlert(b);
              const alertMeta = alert ? ALERT_META[alert.type] ?? ALERT_META.NOTE : null;
              return (
                <div key={i} className={`wrvblk${cs.length || active?.block === i ? ' has' : ''}`} data-pblock={i}>
                  <div className="plBody">
                    {alert && alertMeta ? (
                      <div className={`plCallout ${alertMeta.cls}`}>
                        <div className="plCalloutLabel">{alertMeta.label}</div>
                        <Md text={alert.body} />
                      </div>
                    ) : (
                      <Md text={b} />
                    )}
                  </div>
                  {open && active?.block !== i && (
                    <button className="wrvcbtn" title="comment on this block" onClick={() => openComment(i)}>💬 comment</button>
                  )}
                  {notes(i)}
                </div>
              );
            })}
          </div>
        )}
        {mode === 'rendered' && (
          <div className="wrvrender">
            <iframe className="wrvframe" sandbox="allow-scripts" srcDoc={themedMockupDoc(content)} title={binding.name} />
            {/* a rendered artifact has no blocks of ours to anchor to, so its batch collects here */}
            {(!!comments.length || active) && <div className="wrvnotes">{notes(0)}</div>}
          </div>
        )}
        {mode === 'source' && <pre className="wfraw"><code dangerouslySetInnerHTML={{ __html: highlightCode(content, binding.name) }} /></pre>}
        {mode === 'diff' && binding.diffAgainst && <DiffView text={diffRounds(binding.diffAgainst.content, content, binding.name)} />}
      </div>
      {float && (
        <button className="wrvfloat" style={{ left: float.x, top: float.y - 8 }}
          onMouseDown={(e) => e.preventDefault()} onClick={() => openComment(float.block, float.quote)}>💬 Comment</button>
      )}
      {/* the verdict floats bottom-centre OVER the document: the artifact keeps the full width and
          the decision travels with you as you scroll, instead of occupying a header you scroll away
          from. It is the tab's own bar, not a fixed one — the capacity fly-up owns the window's
          bottom-centre (docs/36 §5) and two floating cards must not fight for one position. */}
      <div className={`wrvverdict${open ? '' : ' settled'}`}>
        {error ? <span className="wrverr">{error}</span> : null}
        {binding.gate.humanOnly && <span className="wrvgate human" title="the FSM accepts this sign-off from a human only">human only</span>}
        <span className="wrvlbl">
          {open ? <>Your call on <b>{binding.gate.subject}</b></> : <span className="wrvsettled">{binding.gate.note}</span>}
          {open && count > 0 && <span className="wrvcount" aria-label={`${count} comment${count === 1 ? '' : 's'} pending`}>{count}</span>}
        </span>
        <span className="wrvsep" />
        {binding.verdicts.map((v) => (
          // `accept` is the app's existing affirmative pill (the mockup calls it `.go`) — the
          // verdict bar joins the button family rather than minting a second green
          // A verdict that does not CONSUME the batch is blocked while comments are pending: approving a
          // design you have just written changes on would silently discard them, and the batch is spent
          // by ONE counted action (docs/33 §8 "accumulate, then spend") which approve is not. Delete or
          // send the comments and it comes back.
          //
          // `needsComments` is deliberately NOT symmetric with that. Revise stays ENABLED with no
          // comments because `spend` (above) treats the click as an on-ramp — it opens the comment
          // editor rather than sending an empty batch. Disabling it removed the fastest way IN to
          // leaving a comment, which is the opposite of helping; its tooltip already said what to do.
          <button key={v.id} className={`btn ${v.tone === 'go' ? 'accept' : 'primary'}`}
            disabled={busy || (!v.needsComments && count > 0)}
            onClick={() => spend(v)}
            title={
              v.needsComments && !count
                ? 'leave a comment first — clicking opens the editor; the batch is what gets sent'
                : !v.needsComments && count > 0
                  ? `you have ${count} unsent comment${count === 1 ? '' : 's'} — send them as changes, or delete them to approve`
                  : undefined
            }>
            {busy ? 'sending…' : v.id === 'approve' ? `✓ ${v.label}` : v.label}
          </button>
        ))}
        {binding.openLatest && (
          <button className="btn ghost link" onClick={() => onOpenLatest(binding.openLatest!)}>Open v{binding.openLatestVersion} →</button>
        )}
        <button className="btn ghost" title="close without deciding" aria-label="Close this review" onClick={onClose}>✕</button>
      </div>
    </>
  );
}
