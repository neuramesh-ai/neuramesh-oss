// The design studio's dock state (docs/14, docs/25) — which round is on stage, whether the
// studio is mounted and at full width, and the one-shot reveal when a new round lands.
//
// docs/25: exactly ONE contextual gate. While the studio is open it HOLDS the design approval
// (Approve + Redraw live at its foot), which is why studioOpen leaves here and gates the
// thread's own action row. Split out of thread/TaskThread.tsx.
import { useEffect, useRef, useState } from 'react';
import { pickDesigns } from '../../design/plans';
import { designVer } from '../../review';
import { STUDIO_ANIM_MS } from '../TaskThread';
import type { ArtifactUI, TaskRow } from '../../bridge/rows-board';

export function useDesignDock(d: {
  task: TaskRow;
  arts: ArtifactUI[];
  designOpen: boolean;
  setDesignOpen: (v: boolean) => void;
  setDesignInitialName: (v: string | null) => void;
  setStudioExp: (v: boolean) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  onOpenReview?: (name?: string | null) => void;
}) {
  const { task, arts, designOpen, setDesignOpen, setDesignInitialName, setStudioExp, listRef, onOpenReview } = d;
const { all: designArts, latestRound } = pickDesigns(arts);
const roundMockups = designArts.filter((a) => designVer(a.name) === latestRound && a.inline_content);
// v0.64 retired the tab strip — the thread IS the panel, so opening the studio no
// longer has to switch views first
/**
 * A design round opens as a REVIEW TAB, not the right-side studio column (founder ruling
 * 2026-08-01; reverses the docs/33 §8 split-stage ruling for design review).
 *
 * A design needs WIDTH more than it needs to sit beside the conversation: the studio gave a mockup
 * ~520px of a split sheet, where a tab gives it the whole content area — and the tab already carries
 * the same HUMAN-ONLY verdict bar, so nothing about the DECISION changes. Approving returns to tab 0
 * and the loop proceeds, exactly as it did from the column.
 *
 * It routes through the shell's single artifact door rather than a private opener: the duplication
 * that door exists to prevent is two ways into one review (docs/36 §13, ruling 3), and a second path
 * here would have recreated it somewhere new.
 *
 * Falls back to the studio when no door was passed, so an embedding without it degrades instead of
 * dead-ending on a click.
 */
const openDesign = (name?: string) => {
  if (onOpenReview) {
    // Named → that one direction (a click on its preview). UNNAMED is "Review all designs", which
    // means ALL of them: the round is the thing being judged, and comparing directions is the whole
    // point of a round. The old studio column showed the set behind its own inner tabs; a tab per
    // direction is the same set, in the tab strip, with the full sheet each.
    if (name) { onOpenReview(name); return; }
    if (!roundMockups.length) { onOpenReview(null); return; }
    for (const m of roundMockups) onOpenReview(m.name);
    return;
  }
  setDesignInitialName(name ?? null);
  setDesignOpen(true);
};

// The studio's open/close is a LAYOUT animation: its column grows from zero while the
// thread yields the space, so both move in one gesture. That needs three states, not a
// boolean — mounted-but-closed (so the first frame has a width to grow FROM), open, and
// mounted-while-closing (so the exit is visible at all). The timeout is the guarded
// fallback docs/33 §7 requires: under prefers-reduced-motion the transition never fires,
// so waiting on transitionend alone would strand the panel forever.
const wantStudio = designOpen && roundMockups.length > 0;
const [studioOpen, setStudioOpen] = useState(false); // mounted?
const [studioShown, setStudioShown] = useState(false); // at full width?
useEffect(() => {
  if (wantStudio) {
    setStudioOpen(true);
    // Two frames: one to mount at width 0, one for the browser to notice the change and
    // transition from it. The timer is NOT belt-and-braces — rAF is starved whenever the
    // window is hidden or occluded, and without it the panel would mount at zero width
    // and stay there until the user came back. It opens either way.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setStudioShown(true)); });
    const t = setTimeout(() => setStudioShown(true), 80);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t); };
  }
  setStudioShown(false);
  const t = setTimeout(() => { setStudioOpen(false); setStudioExp(false); }, STUDIO_ANIM_MS + 60);
  return () => clearTimeout(t);
}, [wantStudio]);
// Artifacts and messages sync on separate streams. On a cold task open the
// message watcher can pin first, then the design gallery arrives below the
// viewport. Reveal each newly synced round once so "ready" never looks like
// prose-only chat; normal reading remains untouched after that first reveal.
const revealedDesignRound = useRef<string | null>(null);
useEffect(() => {
  if (!roundMockups.length) return;
  const key = `${task.id}:${latestRound}`;
  if (revealedDesignRound.current === key) return;
  revealedDesignRound.current = key;
  requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
}, [task.id, latestRound, roundMockups.length]);
  return { openDesign, roundMockups, latestRound, studioOpen, studioShown };
}
