// The design studio (docs/14) — the mockup surface the design gate approves against.
// Extracted from App.tsx (track A2); bodies unchanged.
import { AgentAvatar } from '../components/AgentAvatar';
import { IconArrowUp, IconClose, IconCollapse, IconExpand, IconExternal } from '../ui/icons';
import { Md } from '../md/Md';
import { nm as nmBridge } from '../bridge/nm';
import { designMockupLabel, themedMockupDoc, type DesignNote } from './plans';

import { stripSuggestions } from '@neuramesh/shared';
import { type AgentRow } from '../bridge/rows-crew';
import { type MessageRow } from '../bridge/rows-rooms';
import { useEffect, useMemo, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;


/**
 * The Design Studio (docs/14, design round 2026-07-28) — replaces the full-screen
 * DesignReview overlay for EVERY design round, both providers.
 *
 * Docked, it is a resizable peer column beside the thread; expanded (⤢) it takes the
 * sheet and the same three parts rotate — stage left, lane/composer/gate right. It is
 * deliberately NOT a modal: the whole point is that you can look at the design and talk
 * about it at the same time.
 *
 * Nothing typed here moves state. The composer posts plain thread messages (the
 * designer wakes on them via threadwake.ts); the ONLY transition is Redraw, which
 * spends every note in one task.revise_design.
 *
 * `provider` selects the provenance strip and nothing else — an Iris HTML round gets
 * the identical surface minus the external link.
 */
export function DesignStudio({
  taskId, taskNumber, channelId, mockups, round, taskState, provider, externalUrl,
  initialName, rows, agents, designerName, shown, expanded, onToggleExpand, onClose,
}: {
  taskId: string; taskNumber: number; channelId: string;
  mockups: Array<{ id: string; name: string; inline_content: string | null; created_at: string }>;
  round: number; taskState?: string; provider: 'iris' | 'claude-design';
  externalUrl?: string | null; initialName?: string | null;
  rows: MessageRow[]; agents: AgentRow[]; designerName: string;
  /** false for the first frame and again while closing — drives the open/close animation */
  shown: boolean;
  expanded: boolean; onToggleExpand: () => void; onClose: () => void;
}) {
  const readOnly = !!taskState && taskState !== 'design_review';
  const working = taskState === 'designing';
  const [sel, setSel] = useState(() => Math.max(0, mockups.findIndex((m) => m.name === initialName)));
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<'dark' | 'light'>(() => ((document.documentElement.getAttribute('data-theme') ?? 'dark').includes('dark') ? 'dark' : 'light'));
  const [notes, setNotes] = useState<DesignNote[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const noteId = useRef(1);
  const laneRef = useRef<HTMLDivElement | null>(null);

  // Compare only makes sense expanded and with something to compare against
  const canCompare = expanded && mockups.length > 1;
  const showCompare = canCompare && compare;
  const cur = mockups[Math.min(sel, Math.max(0, mockups.length - 1))];
  const doc = useMemo(() => (cur?.inline_content ? themedMockupDoc(cur.inline_content, mode) : ''), [cur?.inline_content, mode]);
  const pair = useMemo(
    () => (showCompare ? mockups.slice(0, 2).map((m) => ({ m, doc: m.inline_content ? themedMockupDoc(m.inline_content, mode) : '' })) : []),
    [showCompare, mockups, mode],
  );

  // The lane is the THREAD, filtered to this round — never a second store. The round
  // starts at its first mockup artifact; before that the conversation belongs to the
  // previous round (or to the brief).
  const since = useMemo(
    () => mockups.reduce<string | null>((min, m) => (!min || m.created_at < min ? m.created_at : min), null),
    [mockups],
  );
  const lane = useMemo(() => {
    const inRound = since ? rows.filter((r) => r.created_at >= since) : rows;
    return (inRound.length ? inRound : rows).slice(-40);
  }, [rows, since]);

  // Keep the lane pinned to the newest message as the designer answers — and to the
  // newest NOTE, which lands below every message. Setting scrollTop synchronously in
  // the effect lands before layout settles (the first paint measured short and the
  // notes sat off-screen while the gate said "Redraw 2"), so pin on the next frame.
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    pin();
    const raf = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(raf);
  }, [lane.length, notes.length, expanded]);

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'action failed');
  const addNote = (text: string, from?: string | null) => {
    const t = text.trim();
    if (!t || notes.some((n) => n.text === t)) return;
    setNotes((ns) => [...ns, { id: noteId.current++, text: t, from }]);
  };
  const delNote = (id: number) => setNotes((ns) => ns.filter((n) => n.id !== id));
  const saveEdit = () => {
    const t = editDraft.trim();
    setNotes((ns) => (t ? ns.map((n) => (n.id === editing ? { ...n, text: t } : n)) : ns.filter((n) => n.id !== editing)));
    setEditing(null); setEditDraft('');
  };

  // talking never moves state — a plain thread message the designer wakes on
  const say = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr('');
    try { await nm?.sendThread(taskId, channelId, text); setDraft(''); } catch (e) { fail(e); }
    setBusy(false);
  };
  const approve = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { await nm?.taskAction('task.approve_design', taskId); onClose(); } catch (e) { fail(e); setBusy(false); }
  };
  // the ONE transition: every note spent in a single round — the review tab's batch shape.
  // The 🎨 packet prefix is load-bearing — designerFlow reads recent human messages as
  // the redraft feedback, so the thread line and the audited command carry one text.
  const redraw = async () => {
    if (!notes.length || busy) return;
    setBusy(true); setErr('');
    const lines = notes.map((n) => `— ${n.text}`).join('\n');
    const packet = `🎨 Design changes requested on #${taskNumber} (round ${round}):\n${lines}`;
    try {
      await nm?.sendThread(taskId, channelId, packet);
      await nm?.taskAction('task.revise_design', taskId, packet);
      setNotes([]);
    } catch (e) { fail(e); }
    setBusy(false);
  };

  const claude = provider === 'claude-design';
  const stage = (
    <>
      <div className="dstagehead">
        <span className="dround">ROUND {round}</span>
        <div className="ddirs">
          {mockups.map((m, i) => (
            <button key={m.id} className={`ddir${!showCompare && i === sel ? ' on' : ''}`} title={m.name}
              onClick={() => { setSel(i); setCompare(false); }}>{designMockupLabel(m.name)}</button>
          ))}
          {canCompare && (
            <>
              <span className="ddirdiv" aria-hidden />
              <button className={`ddir cmp${showCompare ? ' on' : ''}`} title="show both directions side by side"
                onClick={() => setCompare((c) => !c)}>⧉ Compare</button>
            </>
          )}
        </div>
        <div className="dseg" role="group" aria-label="Preview theme">
          <button className={mode === 'light' ? 'on' : ''} title="preview in light" onClick={() => setMode('light')}>☀</button>
          <button className={mode === 'dark' ? 'on' : ''} title="preview in dark" onClick={() => setMode('dark')}>☾</button>
        </div>
        <button className="dsico" title={expanded ? 'collapse — Esc' : 'expand'} aria-label={expanded ? 'Collapse studio' : 'Expand studio'} onClick={onToggleExpand}>
          {expanded ? <IconCollapse s={13} /> : <IconExpand s={13} />}
        </button>
        <button className="dsico" title="close the studio" aria-label="Close studio" onClick={onClose}><IconClose s={12} /></button>
      </div>
      <div className={`dstage${working ? ' stale' : ''}`}>
        {showCompare ? (
          <div className="dcompare">
            {pair.map(({ m, doc: d }) => (
              <div key={m.id} className="dcomppane">
                {d ? <iframe className="dframe" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock" srcDoc={d} title={m.name} /> : <div className="empty">No mockup content.</div>}
                <span className="dcompcap">{designMockupLabel(m.name)}</span>
              </div>
            ))}
          </div>
        ) : doc ? (
          <iframe className="dframe" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads" srcDoc={doc} title={cur?.name ?? 'mockup'} />
        ) : (
          <div className="empty">No mockup content.</div>
        )}
      </div>
      <div className="dprov">
        {/* same fix as .dhandmark: the Iris option is identified by Iris, not by a sparkle */}
        <span className={`dprovmark${claude ? '' : ' iris'}`} aria-hidden>{claude ? 'C' : <AgentAvatar name="iris" size={16} />}</span>
        <span className="dprovtext">
          {working
            ? `Round ${round} shown · ${designerName} is redrawing with your notes`
            : claude
              ? `Claude Design · ${externalUrl ? 'project synced' : 'snapshot only — no editable project'} · ${mockups.length} file${mockups.length === 1 ? '' : 's'}`
              : `${designerName} draft · round ${round} · ${mockups.length} mockup${mockups.length === 1 ? '' : 's'}`}
        </span>
        {claude && externalUrl && (
          <button className="dprovlink" onClick={() => void nm?.openExternal(externalUrl)}>Open the project <IconExternal s={9} /></button>
        )}
      </div>
    </>
  );

  const side = (
    <>
      {/* the lane wears the app's overlay rail instead of a native bar (docs/33: overlay
          scrollbars everywhere, no layout-shifting gutters) — same affordance the thread
          beside it uses, so position feedback survives losing the chrome */}
      <div className="dlanewrap">
      <div className="dlane" ref={laneRef}>
        <div className="dlanekick"><span className="dkick">Round {round} · talk</span></div>
        {lane.map((m) => {
          const mine = m.author_kind === 'human';
          // resolve the agent id to its NAME — DiceBear faces derive from the name, so
          // seeding the avatar with a raw row id gives a different face than every other
          // surface shows for the same teammate
          const name = mine ? 'you' : agents.find((a) => a.id === m.author_id)?.name ?? m.author_id;
          return (
            <div key={m.id} className="dlmsg">
              {mine ? <span className="dlav you">{name.slice(0, 1).toUpperCase()}</span> : <AgentAvatar name={name} size={22} radius={7} />}
              <div className="dlbody">
                <div className="dlhead"><b>{name}</b><span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span></div>
                <div className="dltext"><Md text={stripSuggestions(m.body)} /></div>
                {mine && !readOnly && !notes.some((n) => n.text === m.body.trim()) && (
                  <button className="dmark" title="collect this as a change for the next round" onClick={() => addNote(m.body, m.author_id)}>＋ Make this a note</button>
                )}
              </div>
            </div>
          );
        })}
        {notes.map((n) => (
          <div key={n.id} className="dnote">
            {editing === n.id ? (
              <input className="dnoteedit" value={editDraft} autoFocus onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditing(null); setEditDraft(''); } }}
                onBlur={saveEdit} />
            ) : (
              <span className="dnb"><span className="dkick">Note for round {round + 1}</span><span className="dnt">{n.text}</span></span>
            )}
            <span className="dna">
              <button title="edit this note" onClick={() => { setEditing(n.id); setEditDraft(n.text); }}>✎</button>
              <button title="not a change — drop it" onClick={() => delNote(n.id)}>✕</button>
            </span>
          </div>
        ))}
      </div>
      </div>
      {err && <div className="acterr" style={{ padding: '0 12px 6px' }}>{err}</div>}
      {!readOnly && (
        <div className="dcomp">
          {/* the chint wears the designer's own face, not a generic glyph — you are
              talking to a teammate, and DiceBear derives that face from her name */}
          <div className="dchint">
            <AgentAvatar name={designerName} size={18} radius={6} />
            <span>Talk to {designerName} — ask, or say what should change</span>
          </div>
          <textarea className="dcta" value={draft} rows={1} placeholder="ask, or say what should change…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void say(); } }} />
          <div className="dcrow">
            {draft.trim() && <button className="dmark" title="collect this as a change instead of asking" onClick={() => { addNote(draft); setDraft(''); }}>＋ note</button>}
            <span style={{ flex: 1 }} />
            <button className="dsend" disabled={busy || !draft.trim()} title="send to the thread — ↵" onClick={() => void say()}><IconArrowUp s={12} /></button>
          </div>
        </div>
      )}
      <div className="dgate">
        <div className="dgatecopy">
          <strong>{readOnly ? (working ? 'Round in rework' : 'Design settled') : 'Approve this design?'}</strong>
          <span>{readOnly
            ? working ? `${designerName} is redrawing — the new round lands here.` : 'This round is the build’s visual contract.'
            : 'Yours alone. It becomes the build’s contract.'}</span>
        </div>
        {!readOnly && (
          <div className="dgateacts">
            <button className="btn" disabled={busy || !notes.length} title={notes.length ? `send ${notes.length} note${notes.length === 1 ? '' : 's'} back as round ${round + 1}` : 'collect at least one note first'} onClick={() => void redraw()}>
              ↻ Redraw{notes.length > 0 && <span className="cbadge">{notes.length}</span>}
            </button>
            <button className="btn primary" disabled={busy} title="approve the mockups — the architect plans against them" onClick={() => void approve()}>✓ Approve</button>
          </div>
        )}
      </div>
    </>
  );

  return (
    // `.dstudioinner` is laid out at the FULL target width from the first frame and the
    // outer column clips it. Animating the column alone would reflow the lane, composer
    // and gate on every frame of the open — text re-wrapping while a panel slides is the
    // difference between a curtain and a squeeze.
    <aside
      className={`dstudio${expanded ? ' exp' : ''}${shown ? ' in' : ''}`}
      aria-label={`Design review · round ${round}`}
      aria-hidden={!shown}
    >
      <div className="dstudioinner">
        {expanded ? (
          <>
            <div className="dexpstage">{stage}</div>
            <div className="dexpside">{side}</div>
          </>
        ) : (
          <>{stage}{side}</>
        )}
      </div>
    </aside>
  );
}

// `ArtifactPreview` retired here (docs/36 §6) and `PlanReview` retired here with it (docs/36 §13):
// the full-screen `.apvwrap` overlay is DELETED, not kept beside the tab. Two doors to one review
// is exactly the duplication that made the bottom dock worth retiring, and a review that lives in
// a tab can sit beside the thread it is about — which the overlay, taking the whole window, never
// could. `WReviewView` above is its replacement, and it is a TYPE (plan · release plan · design
// round) rather than a component per kind. `.plBody`/`.plCallout` survive the deletion: they are
// the document-grade markdown ramp, and every surface that renders an agent's markdown wears them.
