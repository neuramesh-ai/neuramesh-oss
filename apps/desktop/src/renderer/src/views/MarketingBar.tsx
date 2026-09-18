// THE BAR (docs/design/marketing-os-desk-2026-09, George 2026-09-17): the pills at the LEFT, the two
// section words at the RIGHT, one line under the desk, sticky inside the scroller. The words are
// subheadings, not tabs — a click scrolls the page to the section (the parent owns the scroller and
// the spy; this file owns the look, the stuck edge and the chips' hand-off). The count rides the lit
// word only, the rail's rule. The chips are the ⌘Y / Home ledger chips, one recipe (.histovlfilter).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { DESK_SECTIONS, DESK_SECTION_LABEL, HANDOFF_MS, signatureEase, type DeskSection } from './mkosdesk';

/** --dur-exit: the old chips leave faster than the new ones arrive (docs/33 §7) */
const EXIT_MS = 130;

export function MarketingBar({ section, counts, chips, onSection }: {
  section: DeskSection;
  counts: Record<DeskSection, number>;
  /** a section's chips, rendered as the `.histovlfilter > button` recipe by the caller */
  chips: (s: DeskSection) => ReactNode;
  onSection: (s: DeskSection) => void;
}) {
  // the stuck edge: a 1px sentinel above the bar leaves the scroller's viewport exactly when the bar
  // reaches the top, so the hairline and the resting shadow arrive with it (elevation over outline)
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setStuck(!e!.isIntersecting), { root: el.parentElement, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // the hand-off: the leaving set stays mounted for its exit, the arriving set rises in (nm-rise,
  // staggered) — only once the section has changed at least once, so the first paint lands whole
  const [leaving, setLeaving] = useState<DeskSection | null>(null);
  const prev = useRef(section);
  const handed = useRef(false);
  useEffect(() => {
    if (prev.current === section) return undefined;
    const from = prev.current;
    prev.current = section;
    handed.current = true;
    setLeaving(from);
    const t = setTimeout(() => setLeaving((cur) => (cur === from ? null : cur)), EXIT_MS);
    return () => clearTimeout(t);
  }, [section]);
  return (
    <>
      <div ref={sentinel} className="mkbarsentinel" aria-hidden />
      <div className={`mkbar${stuck ? ' stuck' : ''}`}>
        <div className="mkchipx">
          {leaving && <div key={`leave-${leaving}`} className="histovlfilter mkchips leave" aria-hidden>{chips(leaving)}</div>}
          <div key={`enter-${section}`} className={`histovlfilter mkchips${handed.current ? ' enter' : ''}`} role="group" aria-label={`Filter ${DESK_SECTION_LABEL[section].toLowerCase()}`}>{chips(section)}</div>
        </div>
        <div className="mkbarwords">
          {DESK_SECTIONS.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span className="mkwordsep" aria-hidden>·</span>}
              <button type="button" className={`mkword${section === s ? '' : ' door'}`} aria-current={section === s ? 'true' : undefined}
                data-tip={section === s ? undefined : `Scroll to the ${DESK_SECTION_LABEL[s].toLowerCase()}`} onClick={() => onSection(s)}>
                {DESK_SECTION_LABEL[s]}{section === s && <b>{counts[s]}</b>}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
}

/** a scripted scroll on the signature ease (docs/33 §7: a hand-off is one gesture, 420 ms), or an
 *  instant jump under reduced motion. `onDone` fires when it lands, so the caller's spy can take over. */
export function animateScroll(el: HTMLElement, to: number, onDone?: () => void): void {
  const from = el.scrollTop;
  const delta = to - from;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || Math.abs(delta) < 1) { el.scrollTop = to; onDone?.(); return; }
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / HANDOFF_MS);
    el.scrollTop = from + delta * signatureEase(t);
    if (t < 1) requestAnimationFrame(step);
    else onDone?.();
  };
  requestAnimationFrame(step);
}
