// THE SHORTCUTS BAND's rows — the render half of shell/navdest.ts, extracted from App.tsx
// (marketing-os round; App sits on its 3000-line ratchet and this block was pure drawing).
// The rows are derived in navdest.ts so the band's one rule — exactly one fill, and Scheduled
// lit on either of its surfaces — is TESTED (src/main/navdest.test.ts). This component only
// draws them; every door is the caller's. The Scheduled fold and its child rows retired
// 2026-09-20: the two surfaces are tabs on the page now (docs/33 §8).
import { IconBoard, IconBranch, IconCode, IconLibrary, IconRepeat, IconTrend, IconWhiteboard } from '../ui/icons';
import { isScheduledView, navDestRows } from './navdest';
import type { MainView } from '../wtabs/guests';

export function NavDestBand({ nav, view, goView, goFiles, goCode, mode }: {
  nav: string;
  view: string;
  /** the rail's mode — Code lists the board and the worktrees instead (navdest.ts) */
  mode?: 'chat' | 'code';
  goView: (v: MainView) => void;
  /** Files is a DOOR like the rest — it fronts tab 0 and closes the open session, same as goView */
  goFiles: () => void;
  /** the Code row is a door onto the Code MODE (the rail's switch), never a view of its own */
  goCode: () => void;
}) {
  const go: Record<string, () => void> = {
    whiteboards: () => goView('whiteboards'),
    // the door opens on Routines; standing on either tab already, the row is a no-op, so the
    // tab you picked never flips back under a click that meant "go to Scheduled"
    scheduled: () => { if (!isScheduledView(nav, view)) goView('automations'); },
    library: goFiles,
    marketing: () => goView('marketing'),
    tasks: () => goView('board'),
    footprint: () => goView('footprint'),
    code: goCode,
  };
  const glyph: Record<string, React.ComponentType<{ s?: number }>> = {
    whiteboards: IconWhiteboard, scheduled: IconRepeat, library: IconLibrary, marketing: IconTrend, tasks: IconBoard, footprint: IconBranch, code: IconCode,
  };
  return navDestRows({ nav, view, mode }).map((r) => {
    const Icon = glyph[r.key];
    return (
      <button key={r.key} data-tour={r.key} className={`navitem${r.on ? ' on' : ''}`} onClick={go[r.key]} title={r.label} aria-label={r.label}>
        {Icon ? <Icon s={16} /> : null}
        <span className="navlabel">{r.label}</span>
      </button>
    );
  });
}
