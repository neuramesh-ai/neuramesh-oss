// THE NAV'S WORKSPACE CARD — the destinations block: Home, Tasks, Whiteboards, Automations,
// Files, and the More flyout that holds the rest.
//
// Split out of App(). In the TOP dock this is row 1; in the side dock it sits inside the scroll
// region so it scrolls with the channels below it, and only there can it collapse. That is why
// it reads both navPos and navSec rather than one nav state.

import { IconActivity, IconAgents, IconBoard, IconCalendar, IconChevron, IconCode, IconCredits, IconFootprint, IconHome, IconLibrary, IconMachine, IconMedal, IconMemory, IconRepeat, IconSkill, IconThreads, IconWhiteboard } from '../ui/icons';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { MainView } from '../wtabs/guests';
import type { NavDest } from '../App';

type NavWorkspaceCardProps = {
  nav: NavDest;
  setNav: Dispatch<SetStateAction<NavDest>>;
  view: MainView;
  setView: Dispatch<SetStateAction<MainView>>;
  navPos: 'left' | 'top' | 'right';
  navSec: Record<string, boolean>;
  secHd: (key: string, label: string, extra?: ReactNode, count?: number) => ReactNode;
  moreOpen: boolean;
  setMoreOpen: Dispatch<SetStateAction<boolean>>;
  needsYou: number;
  roomOpenTasks: number;
  roomRoutines: number;
  roomContent: number;
  /** the Workbench is showing at the frame's right edge — this row is a TOGGLE, not a door */
  wbOpen: boolean;
  onWorkbench: () => void;
};

export function NavWorkspaceCard({ moreOpen, nav, navPos, navSec, needsYou, onWorkbench, roomContent, roomOpenTasks, roomRoutines, secHd, setMoreOpen, setNav, setView, view, wbOpen }: NavWorkspaceCardProps) {
  return (
  <div className="navgroup">
    {secHd('workspace', 'Workspace')}
    {(navPos === 'top' || !navSec.workspace) && (
      <div className="navviews">
        {(() => {
          const navItems: Array<[string, any, string, boolean, () => void, string]> = [
            ['mission', IconHome, 'Home', nav === 'home' && view === 'dashboard', () => { setNav('home'); setView('dashboard'); }, String(needsYou || '')],
            ['threads', IconThreads, 'Threads', nav === 'home' && view === 'chat', () => { setNav('home'); setView('chat'); }, ''],
            ['board', IconBoard, 'Tasks', nav === 'home' && view === 'board', () => { setNav('home'); setView('board'); }, String(roomOpenTasks || '')],
            ['whiteboards', IconWhiteboard, 'Whiteboards', nav === 'home' && view === 'whiteboards', () => { setNav('home'); setView('whiteboards'); }, ''],
            ['footprint', IconFootprint, 'Footprint', nav === 'home' && view === 'footprint', () => { setNav('home'); setView('footprint'); }, ''],
            // Compute rides beside Footprint on purpose: both answer "what is this machine
            // doing", one for disk and one for who it serves. It is a DESTINATION, not the
            // settings modal — "which machine do my agents run on" is a workspace fact you
            // read, not an account preference you go hunting for (George, 2026-08-13).
            ['compute', IconMachine, 'Compute', nav === 'home' && view === 'compute', () => { setNav('home'); setView('compute'); }, ''],
            // Credits sits with Compute + Footprint: all three are "what is this workspace's
            // machine costing / doing" facts you READ, not preferences. (George, 2026-08-31)
            ['credits', IconCredits, 'Credits', nav === 'home' && view === 'credits', () => { setNav('home'); setView('credits'); }, ''],
            // "Scheduled" is a label rename (2026-08-16); the view keys stay automations/calendar
            ['automations', IconRepeat, 'Routines', nav === 'home' && view === 'automations', () => { setNav('home'); setView('automations'); }, String(roomRoutines || '')],
            // this card is a FLAT list of every destination (no disclosure), so Automations'
            // two halves stand as two rows here rather than nesting the way the band does
            ['calendar', IconCalendar, 'Calendar', nav === 'home' && view === 'calendar', () => { setNav('home'); setView('calendar'); }, String(roomContent || '')],
            ['skills', IconSkill, 'Skills', nav === 'home' && view === 'skills', () => { setNav('home'); setView('skills'); }, ''],
            ['agents', IconAgents, 'Agents', nav === 'agents', () => setNav('agents'), ''],
            ['library', IconLibrary, 'Files', nav === 'artifacts', () => setNav('artifacts'), ''],
            ['memory', IconMemory, 'Memory', nav === 'home' && view === 'memory', () => { setNav('home'); setView('memory'); }, ''],
            ['activity', IconActivity, 'Activity', nav === 'logs', () => setNav('logs'), ''],
            ['retro', IconMedal, 'Retro', nav === 'retro', () => setNav('retro'), ''],
            // the Workbench is a PANEL at the frame's right edge, so this row reads its own
            // open state and toggles it (2026-08-16 — the old "Code" row opened an editor tab
            // that rendered a second copy of the Workbench's file tree in the main area)
            ['code', IconCode, 'Workbench', wbOpen, onWorkbench, ''],
          ];
          const PRIMARY = ['mission', 'threads', 'board', 'agents'];
          const renderItem = (item: [string, any, string, boolean, () => void, string]) => {
            const [key, Icon, label, active, go, badge] = item;
            // Home's badge is a NOTIFICATION (things waiting on the human), not an informational
            // count like Board's — it gets the live-signal treatment so it reads from anywhere.
            const attn = key === 'mission' && !!badge;
            return (
              <button key={key} data-tour={key} className={`navitem${active ? ' on' : ''}`} title={attn ? `${label} — ${badge} need${badge === '1' ? 's' : ''} your attention` : label} aria-label={attn ? `${label} — ${badge} need${badge === '1' ? 's' : ''} your attention` : label} onClick={go}>
                <Icon s={17} />
                <span className="navlabel">{label}</span>
                {badge ? <span className={`navitembadge${attn ? ' attn' : ''}`}>{badge}</span> : null}
              </button>
            );
          };
          // Top dock keeps the full row (pills). Side dock compresses to 4 primary items + a "More"
          // group; the hidden items stay in the DOM (aria-label reachable) and auto-reveal when active.
          if (navPos === 'top') return navItems.map(renderItem);
          const primary = navItems.filter((it) => PRIMARY.includes(it[0]));
          const more = navItems.filter((it) => !PRIMARY.includes(it[0]));
          const open = moreOpen || more.some((it) => it[3]);
          const moreBadge = more.reduce((n, it) => n + (parseInt(String(it[5]), 10) || 0), 0);
          return (
            <>
              {primary.map(renderItem)}
              <button className={`navitem navmore${open ? ' open' : ''}`} aria-label="More" aria-expanded={open} title="More" onClick={() => setMoreOpen((o) => !o)}>
                <span className="navmorechev" aria-hidden><IconChevron s={16} /></span>
                <span className="navlabel">More</span>
                {!open && moreBadge ? <span className="navitembadge">{String(moreBadge)}</span> : null}
              </button>
              <div className={`navmoreitems${open ? ' open' : ''}`}>{more.map(renderItem)}</div>
            </>
          );
        })()}
      </div>
    )}
  </div>
  );
}
