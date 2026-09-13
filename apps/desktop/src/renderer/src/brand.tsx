// Porch — the NeuraMesh mark (design_handoff_brand_porch; approved round
// mockups/brand-porch.html, evidence docs/evidence/brand-porch/). One module owns
// every cut and variant so the geometry can never fork again — the Ember era
// shipped three diverged copies of the mark and a fourth hand-inlined one.
//
// Color contract: the mark rides --brand/--brand-ink (constant oak/cream in ALL
// themes, like status hues) — never --accent, which is achromatic in the dark
// themes. The wordmark is always lowercase `neuramesh`, Bricolage 600, ink --text.
import { useEffect, useId, useRef, useState } from 'react';

// Geometry verbatim from the handoff SVGs (48-unit grid).
const CUTS = {
  // standard cut — never render below 24px
  std: {
    arch: 'M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z',
    eyes: [[18.4, 21.5, 2.75], [29.6, 21.5, 2.75]] as const,
    smile: 'M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4', smileW: 2.9,
  },
  // small cut (≤24px): wider arch, bigger eyes, heavier smile
  sm: {
    arch: 'M5.5 22 C5.5 10.5 13.5 3.5 24 3.5 C34.5 3.5 42.5 10.5 42.5 22 L42.5 39 C42.5 42.5 40 44.5 37 44.5 L11 44.5 C8 44.5 5.5 42.5 5.5 39 Z',
    eyes: [[17.8, 21, 3.5], [30.2, 21, 3.5]] as const,
    smile: 'M17 28.6 C20.2 33.6 27.8 33.6 31 28.6', smileW: 4,
  },
  // single-ink outline (watermarks, tray/band chrome) — inherits currentColor
  outline: {
    arch: 'M8 22.5 C8 12 15 6 24 6 C33 6 40 12 40 22.5 L40 38 C40 40.8 38.2 42 36 42 L12 42 C9.8 42 8 40.8 8 38 Z',
    eyes: [[18.8, 21.8, 2.6], [29.2, 21.8, 2.6]] as const,
    smile: 'M18.2 28.2 C20.7 32.4 27.3 32.4 29.8 28.2', smileW: 2.7,
  },
};

export function PorchMark({
  size = 20, cut, variant = 'solid', animated = false, title,
}: {
  size?: number;
  /** geometry cut — defaults by rendered size (standard never below 24px) */
  cut?: 'std' | 'sm';
  /** reversed = cream tile + oak face, ONLY on oak surfaces; outline = currentColor single-ink */
  variant?: 'solid' | 'reversed' | 'outline';
  /** include the peek/look/blink group structure the motion CSS targets */
  animated?: boolean;
  title?: string;
}) {
  const clipId = useId();
  const g = variant === 'outline' ? CUTS.outline : CUTS[cut ?? (size <= 24 ? 'sm' : 'std')];
  const tile = variant === 'reversed' ? 'var(--brand-ink)' : 'var(--brand)';
  const face = variant === 'outline' ? 'currentColor' : variant === 'reversed' ? 'var(--brand)' : 'var(--brand-ink)';
  const eyes = g.eyes.map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill={face} />);
  return (
    <svg
      className="porchmark" width={size} height={size} viewBox="0 0 48 48"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    >
      {variant === 'outline'
        ? <path className="pk-arch" d={g.arch} fill="none" stroke="currentColor" strokeWidth={2.6} />
        : <path className="pk-arch" d={g.arch} fill={tile} />}
      {animated ? (
        <>
          <defs><clipPath id={clipId}><path d={g.arch} /></clipPath></defs>
          <g clipPath={`url(#${clipId})`}>
            <g className="pk-peekg"><g className="pk-lookg"><g className="pk-blinkg">{eyes}</g></g></g>
          </g>
        </>
      ) : (
        <g className="pk-blinkg">{eyes}</g>
      )}
      <path className="pk-smile" d={g.smile} pathLength={1} fill="none" stroke={face} strokeWidth={g.smileW} strokeLinecap="round" />
    </svg>
  );
}

// neuramesh wordmark — lockup or text-only. Top bar spec: 20px mark + 13px text;
// the 1.54 ratio holds that proportion at other sizes. Gap ≈ 0.28 × mark height.
export function Wordmark({ size = 13, mark = true, gap }: { size?: number; mark?: boolean; gap?: number }) {
  const markPx = Math.round(size * 1.54);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: gap ?? Math.round(markPx * 0.28) }}>
      {mark && <PorchMark size={markPx} />}
      <span style={{ font: `600 ${size}px/1 var(--fbrand)`, letterSpacing: '-0.015em', color: 'var(--text)' }}>
        neuramesh
      </span>
    </span>
  );
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// one-shot blink on the nearest .porchmark — finished CSS animations can't restart,
// so clear the class, force reflow, re-add (the handoff's replay trick).
function blinkIn(host: HTMLElement | null) {
  if (!host || reducedMotion()) return;
  const svg = host.querySelector<SVGElement>('.porchmark');
  if (!svg) return;
  svg.classList.remove('blinking');
  void svg.getBoundingClientRect();
  svg.classList.add('blinking');
}

// The frame lockup with Porch's rationed heartbeat (approved round §C — one
// heartbeat, this mark only): blink on window refocus (30s throttle), once per
// ≥4-minute idle stretch (suppressed while a gate card is docked), and on hover.
export function BrandLockup({ size = 13 }: { size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let lastFocusBlink = 0;
    let lastActivity = Date.now();
    let idleBlinked = false;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusBlink > 30_000) { lastFocusBlink = now; blinkIn(ref.current); }
    };
    const onActivity = () => { lastActivity = Date.now(); idleBlinked = false; };
    const idleTimer = window.setInterval(() => {
      if (idleBlinked || Date.now() - lastActivity < 240_000) return;
      if (document.querySelector('.gatecard')) return; // a gate is asking — stay still
      idleBlinked = true;
      blinkIn(ref.current);
    }, 30_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
    return () => {
      window.clearInterval(idleTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('wheel', onActivity);
    };
  }, []);
  return (
    <span ref={ref} className="brandlockup" onMouseEnter={() => blinkIn(ref.current)}>
      <Wordmark size={size} />
    </span>
  );
}

// Home's all-clear moment: Porch peeks in the empty-state well. `play` fires the
// condensed grammar only when the state is REACHED (queue just drained), never on
// every visit — the parent tracks the transition.
export function CaughtUpPeek({ play }: { play: boolean }) {
  return (
    <span className={`caughtporch${play && !reducedMotion() ? ' playpeek' : ''}`} aria-hidden>
      <PorchMark size={56} cut="std" animated />
    </span>
  );
}

/**
 * Home's wordmark watermark: `neuramesh` set enormous behind the composer.
 *
 * Two rules make it texture rather than a logo parked on the page:
 *  · it is **clipped by the composer** (the layer's bottom sinks behind it), so it reads as a
 *    surface the composer sits on rather than a graphic floating above one;
 *  · it **bleeds past the reading column** and the sheet crops it. A wordmark you can read in
 *    full is a logo; one that runs off the edge is a material.
 *
 * It rests at the whisper ink always (2026-07-30). The v0.62 fill-fade — loudest when empty,
 * gone by 4 items — meant any real workspace never saw it at all.
 */
export function HomeWatermark(_props: { fill?: number }) {
  // v0.62 faded this with Home's fullness (gone by 4 items) — and on any real workspace the
  // queue lives above 4, so the mark was simply never seen (George, 2026-07-30: "missing").
  // It is 6-7% ink TEXTURE behind the composer, unobtrusive by construction, so it now
  // simply stays. The fill prop remains accepted so call sites need no lockstep change.
  return (
    <div className="homewm" aria-hidden>
      <span>neuramesh</span>
    </div>
  );
}

// ── The launch moment (approved round §A) ────────────────────────────────────
// Full Peek (~3s) once on first open, the short wake (~0.9s) on every launch
// after; replayable from Appearance via the 'nm:replay-peek' event. Plays over
// the frame on --win, never gates input (pointer-events: none), skipped entirely
// under reduced motion. Exit = the container's pk-out animationend, with a hard
// timeout fallback so nothing can strand the overlay (docs/33 §7).
const PEEK_SEEN_KEY = 'nm:peek-seen';

function initialPeekMode(): 'full' | 'wake' | null {
  if (typeof window === 'undefined' || reducedMotion()) return null;
  // harness hook (preview/evidence): ?nmpeek=off|full|wake forces a mode
  const forced = new URLSearchParams(window.location.search).get('nmpeek');
  if (forced === 'off') return null;
  if (forced === 'full' || forced === 'wake') return forced;
  try {
    return localStorage.getItem(PEEK_SEEN_KEY) ? 'wake' : 'full';
  } catch {
    return 'wake';
  }
}

export function LaunchPeek() {
  const [mode, setMode] = useState<'full' | 'wake' | null>(initialPeekMode);
  const [run, setRun] = useState(0); // bumped to replay (fresh subtree = fresh animations)
  useEffect(() => {
    if (mode === 'full') { try { localStorage.setItem(PEEK_SEEN_KEY, '1'); } catch { /* private mode */ } }
  }, [mode]);
  useEffect(() => {
    const onReplay = () => { if (!reducedMotion()) { setMode('full'); setRun((r) => r + 1); } };
    window.addEventListener('nm:replay-peek', onReplay);
    return () => window.removeEventListener('nm:replay-peek', onReplay);
  }, []);
  useEffect(() => {
    if (!mode) return;
    const t = window.setTimeout(() => setMode(null), mode === 'full' ? 3800 : 1300);
    return () => window.clearTimeout(t);
  }, [mode, run]);
  if (!mode) return null;
  return (
    <div
      key={run}
      className={`launchpeek ${mode}`}
      aria-hidden
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && e.animationName === 'pk-out') setMode(null); }}
    >
      <PorchMark size={140} cut="std" animated />
      <span className="lpwm">neuramesh</span>
    </div>
  );
}
