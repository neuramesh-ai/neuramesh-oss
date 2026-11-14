// THE DESTINATION ROWS' render half (shell/navdest.ts derives, this draws). Extracted from App.tsx
// in the marketing-os round (App sits on its 3000-line ratchet). The rows are derived in navdest.ts
// so the band's rules are TESTED (navdest.test.ts); every door is the caller's.
//
// THE LEFT-NAV ROUND (2026-09-26, George): the rows sit under the verb with no kicker above them,
// and the More row opens the row menu the project folders wear (views/NavGroups.tsx): fixed beside
// the row, a transparent scrim, text with icons. While you stand in one of More's rows, the row
// wears the fill and its trailing slot names the place (navdest's `inside`).
import { useEffect, useState } from 'react';
import { IconCredits, IconTeam, IconBoard, IconChevron, IconCode, IconLibrary, IconMoreH, IconRepeat, IconSliders, IconTrend, IconWhiteboard } from '../ui/icons';
import { isCustomizationsView, isScheduledView, navDestRows, navMoreRows } from './navdest';
import type { MainView } from '../wtabs/guests';

type Anchor = { top: number; left: number };
const GLYPH: Record<string, React.ComponentType<{ s?: number }>> = {
  team: IconTeam, scheduled: IconRepeat, customizations: IconSliders, marketing: IconTrend, more: IconMoreH, finance: IconCredits,
  whiteboards: IconWhiteboard, library: IconLibrary, legacy: IconCode, tasks: IconBoard, worktrees: IconCode,
};

export function NavDestBand({ nav, view, goView, goFiles, goAgents }: {
  nav: string;
  view: string;
  goView: (v: MainView) => void;
  /** Files is a DOOR like the rest: it fronts tab 0 and closes the open session, same as goView */
  goFiles: () => void;
  goAgents: () => void;
}) {
  const [more, setMore] = useState<Anchor | null>(null);
  useEffect(() => {
    if (!more) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [more]);
  const go: Record<string, () => void> = {
    // a two-lens door opens on its first lens; standing on either tab already, the row is a no-op,
    // so the tab you picked never flips back under a click that meant "go there"
    team: goAgents,
    scheduled: () => { if (!isScheduledView(nav, view)) goView('automations'); },
    customizations: () => { if (!isCustomizationsView(nav, view)) goView('skills'); },
    marketing: () => goView('marketing'),
    whiteboards: () => goView('whiteboards'),
    library: goFiles,
    legacy: () => goView('engineering'),
    finance: () => goView('finance'),
    tasks: () => goView('board'),
    worktrees: () => goView('worktrees'),
  };
  // the menu sits beside the row and never runs off the bottom of the window (the folders' anchor)
  const openMore = (el: HTMLElement) => {
    const b = el.getBoundingClientRect();
    setMore({ left: Math.round(Math.max(8, Math.min(b.right + 8, window.innerWidth - 228))), top: Math.round(Math.min(b.top, window.innerHeight - 210)) });
  };
  return (<>
    {navDestRows({ nav, view }).map((r) => {
      const Icon = GLYPH[r.key];
      if (r.key !== 'more') {
        return (
          <button key={r.key} type="button" data-tour={r.key} className={`navitem${r.on ? ' on' : ''}`} onClick={go[r.key]} aria-label={r.label} aria-current={r.on ? 'page' : undefined}>
            {Icon ? <Icon s={16} /> : null}
            <span className="navlabel">{r.label}</span>
          </button>
        );
      }
      return (
        <button key={r.key} type="button" data-tour={r.key} className={`navitem${r.on ? ' on' : ''}`} aria-label={r.label} aria-haspopup="menu" aria-expanded={!!more}
          onClick={(e) => (more ? setMore(null) : openMore(e.currentTarget))}>
          {Icon ? <Icon s={16} /> : null}
          <span className="navlabel">{r.label}</span>
          <span className="navitemtrail" aria-hidden>
            {r.inside && <span className="navitemfact">{r.inside}</span>}
            <span className="navitemchev"><IconChevron s={12} /></span>
          </span>
        </button>
      );
    })}
    {more && (<>
      <div className="projmenu-scrim" onClick={() => setMore(null)} />
      <div className="navrowmenu" role="menu" aria-label="More destinations" style={{ top: more.top, left: more.left }}>
        {navMoreRows({ nav, view }).map((r) => {
          const Icon = GLYPH[r.key];
          return (
            <button key={r.key} type="button" role="menuitem" className={r.on ? 'on' : ''} aria-label={r.label} aria-current={r.on ? 'page' : undefined}
              onClick={() => { setMore(null); go[r.key]?.(); }}>
              {Icon ? <Icon s={13} /> : null}{r.label}
            </button>
          );
        })}
      </div>
    </>)}
  </>);
}
