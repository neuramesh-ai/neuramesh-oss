// THE SHORTCUTS BAND's rows — the render half of shell/navdest.ts, extracted from App.tsx
// (marketing-os round; App sits on its 3000-line ratchet and this block was pure drawing).
// The rows are derived in navdest.ts so the four 2026-08-16 rules — children always present,
// exactly one fill, the fold is the human's, a folded parent keeps its count — are TESTED
// (src/main/navdest.test.ts). This component only draws them; every door is the caller's.
import { IconBoard, IconBranch, IconChevron, IconCode, IconLibrary, IconRepeat, IconTrend, IconWhiteboard } from '../ui/icons';
import { SCHEDULED_SEC, navDestRows } from './navdest';
import type { MainView } from '../wtabs/guests';

export function NavDestBand({ nav, view, navSec, routines, calendar, goView, goFiles, toggleScheduled, goCode, mode }: {
  nav: string;
  view: string;
  /** the rail's mode — Code lists the board and the worktrees instead (navdest.ts) */
  mode?: 'chat' | 'code';
  navSec: Record<string, boolean>;
  routines: number;
  calendar: number;
  goView: (v: MainView) => void;
  /** Files is a DOOR like the rest — it fronts tab 0 and closes the open session, same as goView */
  goFiles: () => void;
  /** the parent TOGGLES and never navigates — a parent that opens its own default child is
   *  two doors onto one surface */
  toggleScheduled: () => void;
  /** the Code row is a door onto the Code MODE (the rail's switch), never a view of its own */
  goCode: () => void;
}) {
  const go: Record<string, () => void> = {
    whiteboards: () => goView('whiteboards'),
    automations: () => goView('automations'),
    calendar: () => goView('calendar'),
    library: goFiles,
    scheduled: toggleScheduled,
    marketing: () => goView('marketing'),
    tasks: () => goView('board'),
    footprint: () => goView('footprint'),
    code: goCode,
  };
  const glyph: Record<string, React.ComponentType<{ s?: number }>> = {
    whiteboards: IconWhiteboard, scheduled: IconRepeat, library: IconLibrary, marketing: IconTrend, tasks: IconBoard, footprint: IconBranch, code: IconCode,
  };
  return navDestRows({ nav, view, scheduledFolded: !!navSec[SCHEDULED_SEC], routines, calendar, mode }).map((r) => {
    const Icon = glyph[r.key];
    const parent = r.tier === 'parent';
    return (
      <button key={r.key} data-tour={r.key}
        className={`navitem${r.on ? ' on' : ''}${parent ? ' navparent' : ''}${r.inGroup ? ' ingroup' : ''}${r.tier === 'sub' ? ' navsub' : ''}`}
        onClick={go[r.key]}
        aria-expanded={parent ? !r.folded : undefined}
        title={parent ? `${r.label} — ${r.folded ? 'expand' : 'collapse'}` : r.label}
        aria-label={parent ? `${r.label}, ${r.folded ? 'collapsed' : 'expanded'}` : r.label}>
        {Icon ? <Icon s={16} /> : null}
        <span className="navlabel">{r.label}</span>
        {r.count ? <span className="navitembadge">{r.count > 99 ? '99+' : r.count}</span> : null}
        {parent && <span className={`navpchev${r.folded ? ' c' : ''}`} aria-hidden><IconChevron s={13} /></span>}
      </button>
    );
  });
}
