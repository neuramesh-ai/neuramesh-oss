// The phase spectrum and the beats tracker (docs/17, docs/24) — where a task is in its
// journey, and what it has done. Extracted from App.tsx (track A3).
import { type BeatUI } from '../bridge/rows-board';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { type JourneyLeg } from '@neuramesh/shared';

// ── The phase ring (docs/24 §2, v0.68): the same journey, wound into a dial ──
//
// The panel's spectrum was a full-width ribbon of coloured bars across the top of a task —
// six phases' worth of paint for one fact ("you are on leg 3 of 5"), and its meaning lived
// entirely in a hover. At panel scale it read as decoration competing with the title.
// The ring says the same thing beside the state chip: one dotted arc per leg, the position
// as its label, and the whole story on hover. Same derived legs (journeyFor), same tokens,
// same rules — done solid · live filled by beats and breathing · ahead ghosted · unstaffed a
// dashed hollow in the blocked tone. The 4px board-card whisper is unchanged.
//
// It lives in the ID ROW, not the title row (review round, 2026-07-29): the chip says where
// the task is in the FSM and the ring says where it is in the journey — the same fact at two
// resolutions, so they read as one status cluster, the title row goes back to being pure
// title, and the dial stops sharing a column with the action pins. `3/4` sits BESIDE the
// dial rather than inside it, so the numerals read at the id row's own type size instead of
// being squeezed to fit a 26px circle.
export const RING_R = 13;

export const RING_C = 2 * Math.PI * RING_R;

export const RING_GAP = 4; // arc units between legs — the "dotted" in dotted circle

export function PhaseRing({ legs }: { legs: JourneyLeg[] }) {
  const [open, setOpen] = useState(false);
  if (legs.length < 2) return null;
  const liveIdx = legs.findIndex((l) => l.status === 'live');
  const live = liveIdx >= 0 ? legs[liveIdx]! : null;
  const doneCount = legs.filter((l) => l.status === 'done').length;
  // "where am I" reads as a POSITION, not a completion percentage: the live leg is the one
  // you are on, so build-live after design+plan reads 3/5 rather than 2/5.
  const at = Math.min(legs.length, doneCount + (live ? 1 : 0));
  const seg = RING_C / legs.length - RING_GAP;
  const arc = (i: number, len: number) => ({
    strokeDasharray: `${Math.max(0, len)} ${RING_C}`,
    strokeDashoffset: -(i * (RING_C / legs.length) + RING_GAP / 2),
  });
  return (
    <div
      className={`pring${open ? ' open' : ''}${live ? ' live' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      tabIndex={0}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      role="img"
      aria-label={`Phase ${at} of ${legs.length}${live ? ` — ${live.label}${live.owner ? ` with ${live.owner}` : ''}` : ''}`}
    >
      <svg viewBox="0 0 32 32" className="pringsvg" aria-hidden>
        {legs.map((l, i) => (
          <g key={l.key} style={{ ['--segc' as never]: `var(${l.colorVar})` }}>
            <circle
              className={`pseg p-${l.status}`}
              cx="16" cy="16" r={RING_R} fill="none"
              style={arc(i, seg)}
            />
            {l.status === 'live' && (
              <circle className="psegfill" cx="16" cy="16" r={RING_R} fill="none" style={arc(i, seg * (l.fill ?? 0.5))} />
            )}
          </g>
        ))}
      </svg>
      <span className="pringn" style={live ? { ['--segc' as never]: `var(${live.colorVar})` } : undefined} aria-hidden>
        <b>{at}</b>/{legs.length}
      </span>
      {open && (
        <div className="pringtip" role="tooltip">
          <div className="pringtiph">Phase {at} of {legs.length}{live ? ` · ${live.label.toLowerCase()}` : ''}</div>
          {legs.map((l) => (
            <div key={l.key} className={`pringrow r-${l.status}`} style={{ ['--segc' as never]: l.status === 'gap' ? 'var(--blocked)' : `var(${l.colorVar})` }}>
              <span className="pringdot" />
              <span className="pringlab">{l.label}</span>
              <span className="pringwho">
                {l.status === 'gap' ? `no ${l.key === 'ship' ? 'shipper' : l.key === 'review' ? 'reviewer' : 'teammate'} in this room`
                  : l.status === 'done' ? `${l.owner ?? '—'} · done`
                    : l.status === 'live' ? `${l.owner ?? '—'} · ${l.fill !== undefined ? `${Math.round(l.fill * 100)}% by beats` : 'working'}`
                      : `${l.owner ?? '—'} · up next`}
              </span>
            </div>
          ))}
          <div className="pringfoot">derived from routing + staffing</div>
        </div>
      )}
    </div>
  );
}

// Beats tracker (docs/17): the assigned agent's ordered steps for the current phase, live above
// the composer; prior phases collapse into compact history blocks. Monochrome — shape and motion
// carry the state (--beat is one neutral tone, set in tokens.css; it no longer tints by role).
export const BEAT_PHASE_LABEL: Record<string, string> = { planning: 'Planning', designing: 'Designing', in_progress: 'Building', in_review: 'Reviewing' };

export const BeatCheck = () => (
  <svg className="beatcheck" viewBox="0 0 17 17" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="8.5" /><path d="M4.7 8.8l2.4 2.4 5-5.2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export const BeatRows = ({ run }: { run: BeatUI[] }) => (
  <div className="beatlist">
    {run.map((b) => (
      <div key={b.id} className={`beat ${b.status}`}>
        <span className="beatind">{b.status === 'done' ? <BeatCheck /> : b.status === 'active' ? <span className="beatdot" /> : <span className="beatring" />}</span>
        <span className="beattitle">{b.title}</span>
      </div>
    ))}
  </div>
);

export function BeatsTracker({ beats, ticker, activePhase }: { beats: BeatUI[]; ticker?: boolean; activePhase?: string }) {
  const runs = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, BeatUI[]>();
    for (const b of beats) { if (!by.has(b.run_id)) { by.set(b.run_id, []); order.push(b.run_id); } by.get(b.run_id)!.push(b); }
    return order.map((id) => by.get(id)!);
  }, [beats]);
  // Every set minimizes/expands from its title row. The live tracker starts open and
  // RE-opens whenever a new set is declared (a rework's fresh beats announce themselves
  // even if the previous tracker was minimized); history blocks start collapsed — and
  // once there are 2+ of them they nest under one collapsed "Earlier phases" parent
  // (v0.33), so a long task's finished sets read as a single quiet row.
  // ticker mode (v0.36, the task panel): the tracker rests as its ONE-LINE title row —
  // breathing dot · current beat · n/m · micro-bar — and a new set re-announces on that
  // line instead of re-expanding; history stays tucked away until the ticker is opened.
  const liveIndex = activePhase ? runs.findLastIndex((run) => run[0]!.phase === activePhase) : runs.length - 1;
  const phaseRuns = liveIndex >= 0 ? runs.slice(0, liveIndex + 1) : [];
  const liveRunId = phaseRuns.length ? phaseRuns[phaseRuns.length - 1]![0]!.run_id : null;
  const [liveOpen, setLiveOpen] = useState(!ticker);
  const [peek, setPeek] = useState(false); // hover reveal; the click still PINS it open
  const [openHist, setOpenHist] = useState<Record<string, boolean>>({});
  const [histOpen, setHistOpen] = useState(false);
  useEffect(() => { setLiveOpen(!ticker); setPeek(false); setOpenHist({}); setHistOpen(false); }, [liveRunId, ticker]);
  // At rest the ticker is a 0/5 dial (v0.69.1) — the full-width panel duplicated the live run
  // card that now narrates the same work a few rows above it. Expanded = pinned OR hovered.
  const shown = liveOpen || peek;
  if (!phaseRuns.length) return null;
  const live = phaseRuns[phaseRuns.length - 1]!;
  const history = phaseRuns.slice(0, -1);
  const liveRole = live[0]!.role;
  const done = live.filter((b) => b.status === 'done').length;
  const histBeatCount = history.reduce((n, r) => n + r.length, 0);
  const histDoneCount = history.reduce((n, r) => n + r.filter((b) => b.status === 'done').length, 0);
  const histRows = history.map((run) => {
    const id = run[0]!.run_id;
    const open = !!openHist[id];
    return (
      <div key={id} className="beathist">
        <button type="button" className="beathisthead" aria-expanded={open} title={open ? 'Collapse this set' : 'Expand this set'}
          onClick={() => setOpenHist((o) => ({ ...o, [id]: !o[id] }))}>
          <span className={`beatchev${open ? ' open' : ''}`}>▸</span>
          <span className="beathisttxt">{BEAT_PHASE_LABEL[run[0]!.phase] ?? run[0]!.role} · {run.length} beats</span>
          <span className="beathistdone"><BeatCheck /> done</span>
        </button>
        {open && <BeatRows run={run} />}
      </div>
    );
  });
  return (
    <div
      className={`beatswrap${ticker ? ' tick' : ''}${shown ? ' shown' : ''}`}
      onMouseEnter={ticker ? () => setPeek(true) : undefined}
      onMouseLeave={ticker ? () => setPeek(false) : undefined}
    >
      {/* Finished sets belong to the full tracker, not the dial. In ticker mode the dial answers
          one question — how far into the CURRENT phase are we — and an "Earlier phases · 4 sets"
          fold hanging off a hover popover answers a question nobody hovered to ask. The history
          is still there in the non-ticker tracker and in the thread's own transcript. */}
      {!ticker && (history.length >= 2 ? (
        <div className="phasefold">
          <button type="button" className="phasefoldhead" aria-expanded={histOpen} title={histOpen ? 'Collapse earlier phases' : 'Expand earlier phases'}
            onClick={() => setHistOpen((o) => !o)}>
            <span className={`beatchev${histOpen ? ' open' : ''}`}>▸</span>
            <span className="phasefoldtxt"><b>Earlier phases</b> · {history.length} sets · {histBeatCount} beats</span>
            <span className="beathistdone">{histDoneCount === histBeatCount ? <><BeatCheck /> all done</> : <span className="phasefoldnum">{histDoneCount}/{histBeatCount}</span>}</span>
          </button>
          {histOpen && <div className="phasefoldinner">{histRows}</div>}
        </div>
      ) : histRows)}
      {ticker ? (
        // The dial IS the anchor: it never swaps out, so the steps grow from the thing you
        // hovered instead of the row reflowing under the cursor. The panel is a popover
        // (absolute, bottom-anchored, content-width) — not a full-width band, which is what
        // made it read as a second run card.
        <div className="beats min">
          <button type="button" className="beatshead" aria-expanded={shown} title={liveOpen ? 'Unpin the steps' : 'Show the steps'}
            onClick={() => setLiveOpen((o) => !o)}>
            <span className="tring" style={{ '--frac': `${(done / live.length) * 100}%` } as CSSProperties} aria-hidden />
            <span className="beatcnt"><b>{done}</b>/{live.length}</span>
          </button>
          {shown && (
            <div className="beatpop" role="group" aria-label={`${BEAT_PHASE_LABEL[live[0]!.phase] ?? liveRole} — ${done} of ${live.length} beats done`}>
              <div className="beatpophead">
                <span className="beatphase">{BEAT_PHASE_LABEL[live[0]!.phase] ?? liveRole}</span>
                <span className="beatnum">{done}/{live.length}</span>
              </div>
              <BeatRows run={live} />
            </div>
          )}
        </div>
      ) : (
        <div className={`beats${shown ? '' : ' min'}`}>
          <button type="button" className="beatshead" aria-expanded={shown} title={liveOpen ? 'Unpin the tracker' : 'Pin the tracker open'}
            onClick={() => setLiveOpen((o) => !o)}>
            <span className="beatchev open">▸</span>
            <span className="beatphase">{BEAT_PHASE_LABEL[live[0]!.phase] ?? liveRole}</span>
            <span className="beatprog"><span className="beatnum">{done}/{live.length}</span><span className="beatbar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span></span>
          </button>
          {shown && <BeatRows run={live} />}
        </div>
      )}
    </div>
  );
}
