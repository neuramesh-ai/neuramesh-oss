// The walkthrough — the first-run tour, and the steps it visits.
// Extracted from App.tsx (track A2).

import { useEffect, useMemo, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).


// First-run guided tour of the icon rail — each step spotlights a rail item, navigates to its
// view, and explains it. Keys match the rail buttons' data-tour attribute. `spot` steps only
// spotlight (no click — a section header's click would collapse it); `extend` grows the ring
// downward so a few of the rows under a header sit inside it.
export const TOUR_STEPS: Array<{ key: string; title: string; body: string; spot?: boolean; extend?: number }> = [
  // Anchors must exist in BOTH dock positions. The two that did not are the reason this list was
  // rewritten (2026-08-07): `project` is rendered only when navPos === 'top', and `sect-agents`
  // stopped existing entirely when the rail's channels/people/agents sections became the projects
  // tree. Both skipped silently, so a side-docked first run opened on "2 / 3" and showed exactly
  // one card. `visibleSteps` below now makes that impossible to ship again.
  { key: 'projects', title: 'Your projects', body: 'Every conversation lives here, grouped by project. A pulsing dot means a thread needs you; hover a project for # (choose or create its channels) and ＋ (start a chat there).', spot: true, extend: 40 },
  { key: 'board', title: 'Tasks and the rest', body: 'Tasks, Whiteboards, Automations and Library all follow the project you’re standing in. Describe work in the composer and the orchestrator decides what becomes a task.', spot: true, extend: 72 },
  { key: 'account', title: 'You and your workspace', body: 'Your account, your theme, and where the dock sits. Agents & machines lives here too — and if you belong to more than one workspace, this is where you switch between them.', spot: true },
];

/** The steps whose anchors are ACTUALLY on screen, resolved once at mount.
 *
 *  Without this a missing anchor skipped itself and left the counter counting the step anyway —
 *  the walkthrough opened at "2 / 3" and ended after one card. Filtering first means the count is
 *  honest by construction: it can never promise more cards than it will show. */
export function visibleSteps(): typeof TOUR_STEPS {
  const present = TOUR_STEPS.filter((s) => document.querySelector(`[data-tour="${s.key}"]`));
  // every anchor missing (a layout we did not anticipate) — better to show nothing than a
  // walkthrough that spotlights empty space
  return present;
}

export function Walkthrough({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  // Resolved ONCE, from the layout actually on screen. The counter and the dots both read this,
  // so "N / total" is a promise the tour can keep in any dock position.
  const steps = useMemo(() => visibleSteps(), []);
  const cur = steps[step];
  const last = step === steps.length - 1;
  // spotlight + navigate to the step's view so it's visible behind the popover. Measure AFTER
  // the click's render settles (double rAF) — several targets live in the collapsed "More"
  // group and only get real geometry once their view activates and the group auto-reveals.
  useEffect(() => {
    if (!cur) { finishRef.current(); return; }
    const btn = document.querySelector<HTMLElement>(`[data-tour="${cur.key}"]`);
    // steps were filtered on presence, so a miss here means the anchor vanished mid-tour (a
    // re-render moved it). Ending beats spotlighting empty space.
    if (!btn) { finishRef.current(); return; }
    if (!cur.spot) btn.click();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        btn.scrollIntoView({ block: 'nearest' });
        const r = btn.getBoundingClientRect();
        // extended rings stay inside the viewport — a section near the bottom edge clamps
        const h = Math.min(r.height + (cur.extend ?? 0), window.innerHeight - r.top - 16);
        setRect({ top: r.top, left: r.left, width: r.width, height: Math.max(r.height, h) });
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.key]);
  const finish = () => {
    try { localStorage.setItem('nm:toured', '1'); } catch { /* private mode */ }
    // the tour ends where it began — Home is already the resting view; nothing to click
    onDone(); // the App side also closes the dock the Code step opened
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const next = () => (last ? finish() : setStep((s) => s + 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  if (!rect || !cur) return null;
  const pad = 7;
  const popTop = Math.min(Math.max(14, rect.top - 6), window.innerHeight - 196);
  return (
    <div className="tour" onClick={(e) => e.target === e.currentTarget && undefined}>
      <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-pop" style={{ top: popTop, left: rect.left + rect.width + 18 }}>
        <div className="tour-head"><span className="tour-count">{step + 1} / {steps.length}</span><b>{cur.title}</b></div>
        <p>{cur.body}</p>
        <div className="tour-dots">{steps.map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="tour-actions">
          <button className="tour-skip" onClick={finish}>Skip tour</button>
          {step > 0 && <button className="tour-back" onClick={() => setStep((s) => s - 1)}>Back</button>}
          <button className="btn primary sm" onClick={next}>{last ? 'Got it →' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}
