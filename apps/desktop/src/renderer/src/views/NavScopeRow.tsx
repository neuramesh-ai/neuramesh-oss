// The nav's scope row (flat round, 2026-08-17) — the `PROJECTS` eyebrow and the per-project
// headers it sat above, replaced by one row: fold · project · room · search.
//
// It is the **ScopeBar** idiom every workspace destination has worn since 2026-08-07 (Tasks ·
// Whiteboards · Automations · Files · Skills · Activity), at rail width: narrowing is a visible,
// reversible choice, never an invisible default. Split out of HistoryRail to keep that file under
// the size gate — and because the row is a control, while the rail is a list.
import { IconChevron, IconSearch, IconSettings } from '../ui/icons';
import { ProjLogo } from '../components/AgentAvatar';
import { useEffect } from 'react';

import { type NavFlatProject, type NavTreeChannel } from '../navtree';

export function NavScopeRow({ projects, scopeProject, scopeChannel, channels, askOutside, collapsed, onToggle, onPickProject, onPickChannel, onNewChannelIn, onNewProject, onAllProjects, onExpand, menu, setMenu }: {
  projects: NavFlatProject[];
  scopeProject: NavFlatProject | null;
  scopeChannel: NavTreeChannel | null;
  /** the picked project's rooms — the room menu's list */
  channels: NavTreeChannel[];
  /** an ask the scope or the cap is hiding: the project chip wears a dot for it */
  askOutside: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onPickProject: (projectId: string | null) => void;
  onPickChannel: (channelId: string | null) => void;
  onNewChannelIn: (projectId: string) => void;
  onNewProject: () => void;
  onAllProjects?: () => void;
  onExpand: () => void;
  /** lifted, because the room strip's `+N` opens the room menu too — one list, one menu */
  menu: 'project' | 'room' | null;
  setMenu: (m: 'project' | 'room' | null) => void;
}) {
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [menu, setMenu]);
  return (
    <div className="navscoperow">
      <button className={`navprojchev${collapsed ? ' c' : ''}`} data-tour="projects" onClick={onToggle}
        aria-expanded={!collapsed} title={`${collapsed ? 'Expand' : 'Collapse'} sessions`} aria-label={`${collapsed ? 'Expand' : 'Collapse'} sessions`}>
        <IconChevron s={12} />
      </button>
      {/* a chip's menu anchors to the CHIP, not to the row: `.chpop` is `left: 0`, so without a
          wrapper of its own every menu after the first opens over the first one (2026-08-07) */}
      <div className="navscopewrap">
        {/* THE CHIP NAMES THE LIST, not the filter (George, 2026-08-17). It read "All projects",
            which describes the control's own menu — but the rail is a list of THREADS and the
            project is one way to narrow it, so unscoped it says what you are looking at and
            scoped it says what is narrowing it. (The room chip below is unambiguously a filter:
            it only exists inside a project, so "All rooms" stays right there.)
            The accessible name says what the chip DOES, which the visible label deliberately
            does not — "All threads ▾" alone tells a screen reader nothing about being a filter. */}
        <button className={`cchip${menu === 'project' ? ' open' : ''}${scopeProject ? ' setfilter' : ''}`}
          aria-haspopup="menu" aria-expanded={menu === 'project'}
          aria-label={scopeProject ? `Filter threads: ${scopeProject.name}` : 'Filter threads: all projects'}
          data-tip={scopeProject ? `Showing ${scopeProject.name}` : 'Filter by project'}
          onClick={() => setMenu(menu === 'project' ? null : 'project')}>
          {scopeProject && <ProjLogo logo={scopeProject.logo} name={scopeProject.name} size={13} />}
          <span className="lbl">{scopeProject ? scopeProject.name : 'All threads'}</span>
          {/* narrowing must never silence an ask — same ruling as the tree's collapsed-group dot,
              moved onto the control that does the hiding */}
          {askOutside && <span className="navprojask" title="Something outside this view needs you" aria-label="Needs you" />}
          {scopeProject
            ? <span className="sfx" role="button" aria-label="Show every project" title="Show every project"
                onClick={(e) => { e.stopPropagation(); setMenu(null); onPickProject(null); }}>✕</span>
            : <span className="car" aria-hidden>▾</span>}
        </button>
        {menu === 'project' && (
          <>
            <div className="projmenu-scrim" onClick={() => setMenu(null)} />
            <div className="navscopepop" role="menu">
              <div className="nppsec">Filter by project</div>
              <button role="menuitem" className={`nppitem${scopeProject ? '' : ' on'}`} onClick={() => { setMenu(null); onPickProject(null); }}>
                <span className="nppn">All threads</span>
                {!scopeProject && <span className="nppck" aria-hidden>✓</span>}
              </button>
              <div className="nppsep" />
              {/* EVERY project (2026-08-07's ruling, rehoused): a project that is merely quiet must
                  still be visible, clickable and creatable-in. Here it costs one menu row rather
                  than two rows of rail height, and it carries MORE than the header did — its live
                  pulse and its ask dot, which a collapsed header could only hint at. */}
              {projects.map((p) => (
                <button key={p.id} role="menuitem" className={`nppitem${p.id === scopeProject?.id ? ' on' : ''}`}
                  onClick={() => { setMenu(null); onPickProject(p.id); }}>
                  <ProjLogo logo={p.logo} name={p.name} size={16} />
                  <span className="nppn">{p.name}</span>
                  {p.live && <span className="navprojlive" aria-hidden />}
                  {p.hasAsk && <span className="navprojask" title="Something in here needs you" aria-label="Needs you" />}
                  {p.id === scopeProject?.id ? <span className="nppck" aria-hidden>✓</span> : <span className="nppct">{p.count || '—'}</span>}
                </button>
              ))}
              <div className="nppsep" />
              <button role="menuitem" className="nppnew" onClick={() => { setMenu(null); onNewProject(); }}>＋ New project…</button>
              {onAllProjects && (
                <button role="menuitem" className="nppmanage" onClick={() => { setMenu(null); onAllProjects(); }}>
                  <IconSettings s={12} /> Manage projects…
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {/* the room chip only exists INSIDE a project: across projects the slugs repeat, and a menu
          of four `#marketing`s is a filter you cannot aim (navtree.ts's header note) */}
      {scopeProject && (
        <div className="navscopewrap">
          <button className={`cchip${menu === 'room' ? ' open' : ''}${scopeChannel ? ' setfilter' : ''}`}
            aria-haspopup="menu" aria-expanded={menu === 'room'}
            aria-label={scopeChannel ? `Room scope: #${scopeChannel.slug}` : 'Room scope: all rooms'}
            data-tip={scopeChannel ? `Showing #${scopeChannel.slug}` : 'Filter by room'}
            onClick={() => setMenu(menu === 'room' ? null : 'room')}>
            {scopeChannel && <span className="h" aria-hidden>#</span>}
            <span className="lbl">{scopeChannel ? scopeChannel.slug : 'All rooms'}</span>
            {scopeChannel
              ? <span className="sfx" role="button" aria-label="Show every room" title="Show every room"
                  onClick={(e) => { e.stopPropagation(); setMenu(null); onPickChannel(null); }}>✕</span>
              : <span className="car" aria-hidden>▾</span>}
          </button>
          {menu === 'room' && (
            <>
              <div className="projmenu-scrim" onClick={() => setMenu(null)} />
              <div className="navscopepop" role="menu">
                <div className="nppsec">{scopeProject.name} · rooms</div>
                <button role="menuitem" className={`nppitem${scopeChannel ? '' : ' on'}`} onClick={() => { setMenu(null); onPickChannel(null); }}>
                  <span className="nppn">All rooms</span>
                  {!scopeChannel && <span className="nppck" aria-hidden>✓</span>}
                </button>
                <div className="nppsep" />
                {channels.map((c) => (
                  <button key={c.id} role="menuitem" className={`nppitem${c.id === scopeChannel?.id ? ' on' : ''}`}
                    onClick={() => { setMenu(null); onPickChannel(c.id); }}>
                    <span className="h" aria-hidden>#</span>
                    <span className="nppn">{c.slug}</span>
                    {c.hasAsk && <span className="navchanask" title="Something in here needs you" aria-label="Needs you" />}
                    {c.id === scopeChannel?.id && <span className="nppck" aria-hidden>✓</span>}
                  </button>
                ))}
                <div className="nppsep" />
                <button role="menuitem" className="nppnew" onClick={() => { setMenu(null); onNewChannelIn(scopeProject.id); }}>＋ New channel…</button>
              </div>
            </>
          )}
        </div>
      )}
      <span className="navscopegrow" />
      {/* there is NO search field in the rail (2026-07-29): a rail-width input can only filter the
          rows the rail shows while looking like search. This is the one door to the full history. */}
      <button className="chanadd navhistfind" data-tip="Search threads — ⌘Y" aria-label="Search threads" onClick={onExpand}>
        <IconSearch s={13} />
      </button>
    </div>
  );
}
