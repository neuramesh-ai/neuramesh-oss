// THE GROUPED RAIL's folders (rail-ink round, 2026-09-04, George — the Codex shape): one folder per
// project that holds a session, drawn from navtree.navGrouped's pure result. The rows inside are
// the rail's own rows — HistoryRail hands its renderer in — so a session looks the same whether it
// sits under a folder or in Code mode's flat list. The folder's hover pair and menu live here too.
import { Fragment, useEffect, useRef, useState } from 'react';
import { IconChevron, IconCompose, IconFolder, IconFolderOpen, IconKebab, IconSearch, IconSettings } from '../ui/icons';
import type { NavFlatRowMeta, NavGroup, NavGroupedResult } from '../navtree';
import type { NavBand } from '../navbands';
import type { RailBand } from '../shell/useNavBands';
import { STATE_LABEL } from '../task/labels';
import { timeAgoShort } from '../lib/time';
import { renamable } from '../lib/rowglyph';
import { ENG_LABEL, archivableThreadId, kindOf, titleOf, type Anchor as RowAnchor, type RailRow } from './HistoryRail';
import { IconArchive, IconCheck, IconCheckCircle, IconPen } from '../ui/icons';

type Anchor = { id: string; name: string; count: number; hasAsk: boolean; rooms: string[]; top: number; left: number };
const HOVER_DELAY_MS = 350;

/** the band's head (the nav-recents round, 2026-09-12, George): the list's name is TWO words, RECENTS ·
 *  PROJECTS. The lit word is the view and carries the count; the dim word is the door, one click,
 *  remembered per machine like the mode. Then the fold-all chevron and the ⌘Y magnifier, as before. */
export type NavView = 'recents' | 'projects';
export function NavGroupsHead({ view, onView, count, askFolded, collapsed, onToggle, onExpand }: { view: NavView; onView: (v: NavView) => void; count: number; askFolded: boolean; collapsed: boolean; onToggle: () => void; onExpand: () => void }) {
  const word = (v: NavView, label: string, tip: string) => (
    <button type="button" className={`navgrphdlbl${view === v ? ' on' : ' door'}`} aria-pressed={view === v} data-tip={view === v ? undefined : tip} onClick={() => { if (view !== v) onView(v); }}>{label}</button>
  );
  return (
    <div className="navgrphd">
      <button type="button" className={`navprojchev${collapsed ? ' c' : ''}`} onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} threads`}><IconChevron s={12} /></button>
      {word('recents', 'Recents', 'Every thread, newest first')}
      <span className="navgrphdsep" aria-hidden>·</span>
      {word('projects', 'Projects', 'Folders, one per project')}
      <span className="navgrphdcnt">{count}</span>
      {askFolded && <span className="navprojask" title="A folded project needs you" aria-label="Needs you" />}
      <span className="navscopegrow" />
      <button type="button" className="chanadd navhistfind" data-tip="Search every thread · ⌘Y" aria-label="Search every thread" onClick={onExpand}><IconSearch s={13} /></button>
    </div>
  );
}

/**
 * THE CONNECTION BAND's kicker (U3b, the source-release round — artboards B1, B2): `LOCAL` · `CLOUD`
 * (a custom server's host) in the `.navsect` voice, drawn only when two connections exist. The
 * chevron folds the band, the count is a whisper, and the two signals a fold must not silence stay
 * on the kicker: the live pulse while an agent works there, the ask dot while an ask is folded away.
 * The RECENTS · PROJECTS head above is ONE control and applies inside each band.
 */
export function NavBandHead({ band, onToggle }: { band: Pick<NavBand<unknown>, 'id' | 'name' | 'count' | 'folded' | 'live' | 'hasAsk' | 'on'>; onToggle: (id: string) => void }) {
  return (
    <button type="button" className={`navconn${band.on ? ' on' : ''}`} onClick={() => onToggle(band.id)} aria-expanded={!band.folded}
      aria-label={`${band.name}, ${band.count} ${band.count === 1 ? 'thread' : 'threads'}${band.live ? ', an agent works here' : ''}${band.hasAsk ? ', needs you' : ''}, ${band.folded ? 'folded' : 'open'}`}>
      <span className={`navchev${band.folded ? ' c' : ''}`} aria-hidden><IconChevron s={11} /></span>
      <span className="navconnname">{band.name}</span>
      <span className="navconncnt">{band.count}</span>
      <span className="navconngrow" />
      {band.live && <span className="navconnpulse" aria-hidden />}
      {band.folded && band.hasAsk && <span className="navhistask" aria-hidden />}
    </button>
  );
}

/** Recents' step: the newest rows a list shows before `Show n more` (the nav-recents round) */
export const NAV_RECENTS_CAP = 30;

/** the head's count and ask dot ACROSS the bands: rows in Recents, folders in Projects — and a fold never
 *  silences an ask, whether the fold is a folder's or a whole band's */
export function bandsHead<R>(bands: Array<RailBand<R>>, recents: boolean): { count: number; askFolded: boolean } {
  return { count: bands.reduce((n, b) => n + (recents ? b.count : b.groups.groups.length), 0), askFolded: bands.some((b) => (b.folded && b.hasAsk) || (!recents && b.groups.askFolded)) };
}

/** THE BANDS' LIST (U3b): LOCAL, then CLOUD. Each band holds the view's shape under its kicker — the
 *  rows flat with their own `Show n more` step, or the folders; a folded band shows its kicker alone.
 *  The folder's hover pair and menu act on the FOREGROUND's projects only (a new chat on another
 *  backend would post to the wrong server), so they ride the `.on` band alone. */
export function NavBands<R extends { key: string }>({ bands, recents, codeMode, rowEl, onToggleBand, projectRooms, onToggleFold, onShowMore, onNewChatIn, onAllProjects }: {
  bands: Array<RailBand<R>>;
  recents: boolean;
  codeMode?: boolean;
  rowEl: (r: R & NavFlatRowMeta) => React.ReactNode;
  onToggleBand?: (connectionId: string) => void;
  projectRooms?: Map<string, string[]>;
  onToggleFold?: (projectId: string) => void;
  onShowMore?: (projectId: string) => void;
  onNewChatIn?: (projectId: string) => void;
  onAllProjects?: () => void;
}) {
  // each band pages its own Recents list
  const [pages, setPages] = useState<Record<string, number>>({});
  useEffect(() => { setPages({}); }, [recents, codeMode]);
  const pagesOf = (id: string) => pages[id] ?? 1;
  const empty = <div className="navhistempty">{codeMode ? 'No code work yet' : 'No threads yet'}</div>;
  return (<>{bands.map((b) => (
    <Fragment key={b.id}>
      <NavBandHead band={b} onToggle={(id) => onToggleBand?.(id)} />
      {!b.folded && (recents ? (<>
        {b.rows.length === 0 && empty}
        {b.rows.slice(0, NAV_RECENTS_CAP * pagesOf(b.id)).map((r) => rowEl(r))}
        {b.rows.length > NAV_RECENTS_CAP * pagesOf(b.id) && (
          <button type="button" className="navgrpmore flat" onClick={() => setPages((m) => ({ ...m, [b.id]: pagesOf(b.id) + 1 }))}>Show {Math.min(NAV_RECENTS_CAP, b.rows.length - NAV_RECENTS_CAP * pagesOf(b.id))} more</button>
        )}
      </>) : (<>
        {!b.groups.groups.length && !b.groups.orphans.length && empty}
        <NavGroups groups={b.groups} rowEl={rowEl} projectRooms={b.on ? projectRooms : undefined} onToggleFold={onToggleFold} onShowMore={onShowMore} onNewChatIn={b.on ? onNewChatIn : undefined} onAllProjects={b.on ? onAllProjects : undefined} />
      </>))}
    </Fragment>
  ))}</>);
}

export function NavGroups<R extends { key: string }>({ groups, rowEl, projectRooms, onToggleFold, onShowMore, onNewChatIn, onAllProjects }: {
  groups: NavGroupedResult<R>;
  /** the rail's row renderer — one row, wherever it sits */
  rowEl: (r: NavGroupedResult<R>['orphans'][number]) => React.ReactNode;
  projectRooms?: Map<string, string[]>;
  onToggleFold?: (projectId: string) => void;
  onShowMore?: (projectId: string) => void;
  onNewChatIn?: (projectId: string) => void;
  onAllProjects?: () => void;
}) {
  const [hover, setHover] = useState<Anchor | null>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorOf = (g: NavGroup<R>, el: HTMLElement): Anchor => {
    const b = el.getBoundingClientRect();
    return { id: g.id, name: g.name, count: g.count, hasAsk: g.hasAsk, rooms: projectRooms?.get(g.id) ?? [], left: Math.round(b.right + 8), top: Math.round(Math.min(b.top, window.innerHeight - 150)) };
  };
  const disarm = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setHover(null); };
  const arm = (g: NavGroup<R>, el: HTMLElement) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setHover(anchorOf(g, el)), HOVER_DELAY_MS); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [menu]);
  return (<>
    {groups.groups.map((g) => (
      <div key={g.id} className="navgrp">
        <div className="navhistwrap acts" onMouseEnter={(e) => { if (!menu) arm(g, e.currentTarget); }} onMouseLeave={disarm}>
          {/* the folder: open or closed by its state; click folds — the Codex gesture */}
          <button type="button" className="navgrprow" aria-expanded={!g.folded} onClick={() => onToggleFold?.(g.id)}
            aria-label={`${g.name}, ${g.count} ${g.count === 1 ? 'session' : 'sessions'}${g.hasAsk ? ', needs you' : ''}, ${g.folded ? 'folded' : 'open'}`}>
            <span className="navhistglyph" aria-hidden>{g.folded ? <IconFolder s={14} /> : <IconFolderOpen s={14} />}</span>
            <span className="navhisttitle navgrpname">{g.name}</span>
            <span className="navhisttrail">
              {g.folded && g.hasAsk && <span className="navhistask" aria-label="Needs you" />}
              {g.folded && <span className="navhistfact">{g.count}</span>}
              <span className={`navgrpchev${g.folded ? ' c' : ''}`} aria-hidden><IconChevron s={12} /></span>
            </span>
          </button>
          <span className="navhistact">
            <button type="button" className="navhistbtn" data-tip={`New chat in ${g.name}`} aria-label={`New chat in ${g.name}`}
              onClick={(e) => { e.stopPropagation(); onNewChatIn?.(g.id); }}><IconCompose s={12} /></button>
            <button type="button" className="navhistbtn" data-tip="More" aria-label={`More for ${g.name}`} aria-haspopup="menu" aria-expanded={menu?.id === g.id}
              onClick={(e) => { e.stopPropagation(); disarm(); setMenu(menu?.id === g.id ? null : anchorOf(g, e.currentTarget.closest('.navhistwrap') as HTMLElement)); }}><IconKebab s={13} /></button>
          </span>
        </div>
        {!g.folded && <div className="navgrprows">
          {g.rows.map((r) => rowEl(r))}
          {g.hidden > 0 && <button type="button" className="navgrpmore" onClick={() => onShowMore?.(g.id)}>Show {g.hidden} more</button>}
        </div>}
      </div>
    ))}
    {groups.orphans.map((r) => rowEl(r))}
    {/* the folder's hover card: what the project is — its count, whether it needs you, its rooms */}
    {hover && !menu && (
      <div className="navhistcard navprojcard" role="tooltip" style={{ top: hover.top, left: hover.left }}>
        <div className="nhct">{hover.name}</div>
        <div className="nhcf">
          <span>{hover.count} {hover.count === 1 ? 'session' : 'sessions'}</span>
          {hover.hasAsk && <span className="nhcask">needs you</span>}
          {hover.rooms.length > 0 && <span className="nhcrooms">{hover.rooms.map((r) => `#${r}`).join(' · ')}</span>}
        </div>
      </div>
    )}
    {menu && (<>
      <div className="projmenu-scrim" onClick={() => setMenu(null)} />
      <div className="navrowmenu" role="menu" style={{ top: menu.top, left: menu.left }}>
        <button type="button" role="menuitem" onClick={() => { setMenu(null); onNewChatIn?.(menu.id); }}><IconCompose s={13} />New chat here</button>
        {onAllProjects && <button type="button" role="menuitem" onClick={() => { setMenu(null); onAllProjects(); }}><IconSettings s={13} />Edit projects…</button>}
      </div>
    </>)}
  </>);
}

/** THE ROW's hover card — what the one-line row no longer carries: the full title, the snippet,
 *  and the facts (project · room · branch · state · age, and the live verb while a run is open).
 *  Fixed-positioned beside the row because the list clips its own overflow; it never takes the
 *  pointer, so moving off the row closes it. */
export function RowCard({ hover, liveRuns }: { hover: RowAnchor | null; liveRuns: Map<string, { agent: string | null; step: string | null }> }) {
  if (!hover) return null;
  const h = hover.row;
  const hrun = liveRuns.get(h.task?.id ?? h.threadId ?? '') ?? null;
  return (
    <div className="navhistcard" role="tooltip" style={{ top: hover.top, left: hover.left }}>
      <div className="nhct">{h.task ? `#${h.task.number} · ` : ''}{titleOf(h)}</div>
      {h.snip && <div className="nhcs">{h.snip}</div>}
      <div className="nhcf">
        {h.engineeringSessionId ? <b>Code</b> : h.projectName && <b>{h.projectName}</b>}
        {h.engineeringRepo && <span>{h.engineeringRepo}</span>}
        {h.channelSlug && <span>#{h.channelSlug}</span>}
        {h.branch && <span>⎇ {h.branch}</span>}
        {h.task && <span>{STATE_LABEL[h.task.state] ?? h.task.state}</span>}
        {h.engineeringState && <span>{ENG_LABEL[h.engineeringState] ?? h.engineeringState}</span>}
        {hrun && <span className="nhcl">now · {hrun.agent ? `${hrun.agent} · ` : ''}{hrun.step ?? 'working'}</span>}
        <span>{timeAgoShort(h.when)}</span>
      </div>
    </div>
  );
}

/**
 * THE ROW's HOVER CONTROLS — rename · settle · ⋯, taking the trailing fact's seat.
 *
 * Settle is the round's answer (2026-09-09, George: "when i hover a thread on the left nav i don't
 * see the settle button"). It appears only when the stamp can move something (shared canSettle),
 * so the rail never offers a control that does nothing — and there is no reverse control beside
 * it (George, same day: "not sure we need the back to needs you button"): unsettle is the undo on
 * the settle toast, and a thread comes back on its own when new work lands in it.
 */
export function RowActs({ title, settle, menuOpen, onRename, onSettle, onMenu }: {
  title: string;
  settle: boolean;
  menuOpen: boolean;
  onRename?: () => void;
  onSettle: () => void;
  /** the ⋯ hands back the ROW's box, so the menu opens beside the row rather than the button */
  onMenu: (box: DOMRect) => void;
}) {
  return (
    <span className="navhistact">
      {onRename && (
        <button type="button" className="navhistbtn" data-tip="Rename" aria-label="Rename"
          onClick={(e) => { e.stopPropagation(); onRename(); }}><IconPen s={12} /></button>
      )}
      {settle && (
        <button type="button" className="navhistbtn nhsettle" data-tip="Settle" aria-label={`Settle ${title}`}
          onClick={(e) => { e.stopPropagation(); onSettle(); }}><IconCheckCircle s={13} /></button>
      )}
      <button type="button" className="navhistbtn" data-tip="More" aria-label="More" aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); onMenu((e.currentTarget.closest('.navhistwrap') ?? e.currentTarget).getBoundingClientRect()); }}
      ><IconKebab s={13} /></button>
    </span>
  );
}

/** THE ROW's ⋯ menu — only what the server offers: rename (a chat any time, a task before work
 *  starts) and archive (chats). Nothing invented. */
export function RowMenu({ menu, onClose, onRename, onArchive, settleOf, onSettle }: {
  menu: RowAnchor | null; onClose: () => void; onRename?: (r: RailRow) => void; onArchive?: (threadId: string, title: string) => void;
  /** whether a settle belongs on this row at all (shared canSettle) — there is no reverse item */
  settleOf?: (r: RailRow) => boolean;
  onSettle?: (threadId: string) => void;
}) {
  if (!menu) return null;
  const m = menu.row;
  const archId = archivableThreadId(m);
  const settle = !!onSettle && !!m.threadId && !!settleOf?.(m);
  return (<>
    <div className="projmenu-scrim" onClick={onClose} />
    <div className="navrowmenu" role="menu" style={{ top: menu.top, left: menu.left }}>
      {onRename && renamable(kindOf(m), m.task?.state ?? null) && (
        <button type="button" role="menuitem" onClick={() => onRename(m)}><IconPen s={13} />Rename</button>
      )}
      {/* the row's one status act, where Rename and Archive already live (George, 2026-09-08: "how do I
          settle threads from the left nav"). ONE verb: the reverse one left with the rest of the
          standing bring-back controls (2026-09-09) and lives on the settle toast as Undo. */}
      {settle && (
        <button type="button" role="menuitem" onClick={() => { onClose(); onSettle!(m.threadId!); }}><IconCheck s={13} />Settle</button>
      )}
      {onArchive && archId && (
        <button type="button" role="menuitem" onClick={() => { onClose(); onArchive(archId, m.title); }}><IconArchive s={13} />Archive</button>
      )}
    </div>
  </>);
}
