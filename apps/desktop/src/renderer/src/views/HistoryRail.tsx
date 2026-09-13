// The History rail — the workspace's sessions, scoped. Extracted from App.tsx (track A2).
import { useEffect, useRef, useState } from 'react';
import { IconCheckCircle, IconCircleGlyph, IconCode, IconRoutineClock, IconThreads } from '../ui/icons';
import { NAV_RECENTS_CAP, NavBands, NavGroups, NavGroupsHead, RowActs, RowCard, RowMenu, bandsHead, type NavView } from './NavGroups';
import type { NavConnTag, RailBand } from '../shell/useNavBands';
import { NavScopeRow } from './NavScopeRow';
import { Orb } from '../ui/Orb';
import { STATE_LABEL } from '../task/labels';

import { THREAD_STATUS_LABEL } from '@neuramesh/shared';
import { historyRows, plainTitle, type HistoryRow } from '../room-tabs';
import { orbStateFor } from './SessionList';
import { stripChannels, type NavFlatResult, type NavGroupedResult, type NavTreeChannel } from '../navtree';
import { timeAgoShort } from '../lib/time';
import { renamable, rowGlyphFor, rowTrailFor, type RowKind } from '../lib/rowglyph';
import { type TaskAllRow } from '../bridge/rows-board';

/** a rail row, tagged with the connection it came from when that is not the one the shell stands in (U3b) */
type Row = ReturnType<typeof historyRows<TaskAllRow>>[number] & NavConnTag;
/** a rail row: the history row plus what navFlat decorates it with (project name · logo) */
export type RailRow = NavFlatResult<Row>['rows'][number];
type LiveRun = { agent: string | null; role: string | null; step: string | null; done: number; total: number };
export type Anchor = { key: string; row: RailRow; top: number; left: number };

/** how long the pointer rests on a row before its card opens — a scan down the list must not
 *  flash a card per row (Gemini's tooltip has the same patience) */
const HOVER_DELAY_MS = 350;
const CARD_H = 150;

export function kindOf(r: RailRow): RowKind { return r.engineeringSessionId ? 'code' : r.task ? 'task' : r.scheduleId ? 'routine' : 'chat'; }
/** an engineering session's state, in the vocabulary a human reads (#391's runtime states) */
export const ENG_LABEL: Record<string, string> = { idle: 'idle', streaming: 'working', awaiting_approval: 'needs your approval', resumable: 'paused', completed: 'completed', error: 'failed' };
export function titleOf(r: RailRow): string { return r.task ? plainTitle(r.task.title) : r.title; }

/**
 * The rail's resting list — the nav's width is the whole design constraint here.
 *
 * There is NO search field in the rail (revised 2026-07-29). It briefly had one, then a
 * hover-revealed one, and both were the wrong shape: a rail-width input can only filter the ten
 * rows it can show, so it looked like search while being a fraction of it. The magnifier on the
 * scope row opens the overlay (⌘Y), which leaves exactly one place to search and keeps the rail a
 * pure jump list.
 *
 * ── THE FLAT ROUND (2026-08-17, George) ────────────────────────────────────────────────────
 * The per-project headers, their channel strips and their per-group `n more ›` are gone; the rail
 * is one recency list under one **scope row** — the same ScopeBar idiom every workspace
 * destination has worn since 2026-08-07. See `navtree.ts` for which rulings survived where.
 *
 * ── ONE LINE PER ROW (2026-09-04, George — the rail-ink round) ─────────────────────────────
 * A row is a kind glyph, the title, and ONE trailing thing (lib/rowglyph.ts decides both). The
 * 2026-07-30 "a task keeps its ⎇ line always" and the flat round's "a row says what the scope
 * doesn't" both moved house: everything the two-line row carried — project, branch, state, age,
 * the live verb — comes back on HOVER, as a card beside the row. The card is the elevated
 * stratum (never a native title, trap 10).
 *
 * ── THE SETTLE ROUND (2026-09-09, George — options A + M4) ─────────────────────────────────
 * The trailing slot now holds the thread's STATUS WORD rather than the room fact: `Bring back`
 * in the ⋯ menu named a state the row hid, which is the whole defect. The room and the age move
 * onto the hover card with everything else. The trailing thing yields to THREE controls on
 * hover — rename · settle · ⋯ (views/NavGroups.tsx's RowActs) — where the check appears only
 * when a stamp can move something (shared canSettle). There is no reverse control: unsettle is
 * the UNDO on the settle toast and nowhere else. The menu still carries only what the server
 * offers (thread.settle · thread.archive · thread.update / task.update_details).
 */
export function HistoryRail({ nav, liveIds, liveRuns, askIds, collapsed, openId, onToggle, onPickProject, onPickChannel, onNewChannelIn, onAllProjects, onNewProject, onOpenThread, onOpenTask, onOpenEngineering, onExpand, onArchive, onRename, marksOf, onSettle, codeMode, groups, onToggleFold, onShowMore, onNewChatIn, projectRooms, view = 'projects', onView, bands, onToggleBand, onOpenOn }: {
  /** the scoped list, its rooms and its projects (navtree.ts, pure + tested) */
  nav: NavFlatResult<Row>;
  /** task + thread ids with an OPEN run — the row's glyph becomes the orb while an agent is in there */
  liveIds: Set<string>;
  /** open runs keyed by task/thread id — the trailing progress and the card's live verb */
  liveRuns: Map<string, LiveRun>;
  /** task + thread ids holding a needs-you ask — the trailing accent pulse (colour, never a count) */
  askIds: Set<string>;
  collapsed: boolean;
  /** the task or thread open on the main surface right now — this row wears the selection */
  openId: string | null;
  onToggle: () => void;
  /** null = All projects. Picking a project also makes it the ACTIVE one (it is the switcher). */
  onPickProject: (projectId: string | null) => void;
  /** null = every room of the picked project */
  onPickChannel: (channelId: string | null) => void;
  onNewChannelIn: (projectId: string) => void;
  /** the picker's foot → the All-projects page (rename · archive · delete live there) */
  onAllProjects?: () => void;
  onNewProject: () => void;
  /** the row names its own room, which on an unscoped rail is not the one you are standing in */
  onOpenThread: (id: string, channelId: string | null) => void;
  onOpenTask: (id: string) => void;
  /** Engineering sessions have no room thread id; they route into the Engineering destination. */
  onOpenEngineering: (id: string) => void;
  onExpand: () => void;
  /** archiving a chat row, from the rail people actually browse */
  onArchive?: (threadId: string, title: string) => void;
  /** renaming from the row: a chat any time, a task only before work starts (lib/rowglyph.ts) */
  onRename?: (row: { task: { id: string } | null; threadId: string | null }, title: string) => void;
  /** the three words a thread can wear, plus whether a settle control belongs on the row at all
   *  (shell/rowstatus.ts): the row wears the word, and the hover check settles it */
  marksOf?: (row: RailRow) => { status: 'needs_you' | 'in_progress' | 'settled'; settle: boolean };
  onSettle?: (threadId: string) => void;
  /** Code mode (the Chat | Code switch): the list is already code work (navtree's isCodeRow), so
   *  the row's one fact is its BRANCH — short unscoped, full inside a project — not its room */
  codeMode?: boolean;
  /** THE GROUPED RAIL (rail-ink round, 2026-09-04, George — the Codex shape): the list as folders,
   *  one per project, in BOTH modes (Code's folders hold repo-backed work; an engineering session
   *  has no room, so it lists flat after them). When present the scope row and the flat list step
   *  aside. */
  groups?: NavGroupedResult<Row> | null;
  onToggleFold?: (projectId: string) => void;
  onShowMore?: (projectId: string) => void;
  /** the folder's hover pair: a new chat in that project, and its menu (make active · edit) */
  onNewChatIn?: (projectId: string) => void;
  projectRooms?: Map<string, string[]>;
  /** RECENTS · PROJECTS (the nav-recents round, 2026-09-12): Recents is one flat list of the mode's rows,
   *  newest first, in steps of a cap; Projects is the folders. Absent, the rail is the folders. */
  view?: NavView;
  onView?: (v: NavView) => void;
  /** THE CONNECTION BANDS (U3b, artboards B1, B2): with two connections the list is LOCAL and CLOUD,
   *  each holding the view's shape (rows flat, or folders) under its own kicker. Null with one
   *  connection — the rail is exactly the rail above. A row marked `foreign` (another connection's)
   *  selects nothing and carries no hover controls; opening it goes through `onOpenOn`, the swap. */
  bands?: Array<RailBand<Row>> | null; onToggleBand?: (connectionId: string) => void; onOpenOn?: (row: RailRow) => void;
}) {
  // which scope menu is open — lifted out of NavScopeRow because the room STRIP's `+N` opens the
  // room menu too: one list, one menu, rather than a second popover for the same rooms.
  const [menu, setMenu] = useState<'project' | 'room' | null>(null);
  const [rowMenu, setRowMenu] = useState<Anchor | null>(null);
  /** the row's status word, or null where the row has none (an engineering session is its runtime's) */
  const statusOf = (r: RailRow) => (marksOf && r.threadId && !r.engineeringSessionId ? marksOf(r).status : null);
  /** straight off the shared derivation — never guessed from the word (shared canSettle) */
  const settleOf = (r: RailRow): boolean =>
    !!onSettle && !!marksOf && !!r.threadId && !r.engineeringSessionId && marksOf(r).settle;
  const [hover, setHover] = useState<Anchor | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  // both modes fold by project (George, on sight: Code's flat list read as "just all threads") — and
  // since the nav-recents round the same rows list flat when the human picks Recents
  const recents = view === 'recents' && !!onView;
  const grouped = !!groups && !recents;
  // Recents shows the newest rows and `Show n more` lifts the cap in steps (the folders' idiom)
  const [recentPages, setRecentPages] = useState(1);
  useEffect(() => { setRecentPages(1); }, [recents, codeMode]);
  // THE CONNECTION BANDS (U3b): two connections, and the list is LOCAL · CLOUD in the view's shape
  const banded = !!bands && (grouped || recents);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { rows, projects, scopeProject, scopeChannel, channels, moreCount, askOutside, filteredOut } = nav;

  const disarmHover = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHover(null);
  };
  const armHover = (r: RailRow, el: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const b = el.getBoundingClientRect();
      // the card sits beside the row, and never runs off the bottom of the window
      setHover({ key: r.key, row: r, left: Math.round(b.right + 8), top: Math.round(Math.min(b.top, window.innerHeight - CARD_H)) });
    }, HOVER_DELAY_MS);
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => {
    if (!rowMenu && !renaming) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setRowMenu(null); setRenaming(null); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [rowMenu, renaming]);

  const startRename = (r: RailRow) => { disarmHover(); setRowMenu(null); setRenaming({ key: r.key, value: titleOf(r) }); };
  const commitRename = (r: RailRow) => {
    const value = renaming?.value.trim() ?? '';
    setRenaming(null);
    if (value && value !== titleOf(r)) onRename?.({ task: r.task ? { id: r.task.id } : null, threadId: r.threadId }, value);
  };

  /** ONE row — the flat list and the folders share it */
  const rowEl = (r: RailRow) => {
          // an engineering session (#391) carries its own liveness: streaming is live, an approval
          // waiting on you is the ask; it has no run record, so the orb stands for the stream
          const live = r.engineeringSessionId
            ? r.engineeringState === 'streaming'
            : (r.task && liveIds.has(r.task.id)) || (r.threadId && liveIds.has(r.threadId));
          const ask = !!(r.engineeringSessionId
            ? r.engineeringState === 'awaiting_approval'
            : (r.task && askIds.has(r.task.id)) || (r.threadId && askIds.has(r.threadId)));
          // the row you are STANDING in. Distinct from `live` by design: live is coloured and
          // flat, selected is neutral and lifted — an agent can be working in a thread you do
          // not have open, which is the whole reason those two skins had to stop being one.
          // a row on ANOTHER connection (U3b): the `.on` row is the one row in the foreground band
          const foreign = !!r.foreign;
          const selected = !foreign && !!openId && (r.engineeringSessionId === openId || r.task?.id === openId || r.threadId === openId);
          const run = !r.engineeringSessionId && live ? (r.task && liveRuns.get(r.task.id)) || (r.threadId && liveRuns.get(r.threadId)) || null : null;
          const kind = kindOf(r);
          const state = r.task?.state ?? null;
          const glyph = rowGlyphFor({ kind, state, run: !!run || (kind === 'code' && !!live) });
          const shortBranch = r.branch && r.task ? `nm-${r.task.number}` : r.branch;
          const fact = codeMode
            ? (r.engineeringSessionId
                ? (scopeProject && r.branch ? `⎇ ${r.branch}` : r.engineeringRepo ?? null)
                : r.branch ? `⎇ ${scopeProject ? r.branch : shortBranch}` : null)
            : (!scopeChannel && r.channelSlug ? `#${r.channelSlug}` : null);
          const status = statusOf(r);
          const trail = rowTrailFor({ status, ask, run: run ? { done: run.done, total: run.total } : null, fact, when: timeAgoShort(r.when) });
          const canRename = !foreign && !!onRename && renamable(kind, state);
          const canArchive = !foreign && !!onArchive && !!archivableThreadId(r);
          const canSettle = !foreign && settleOf(r);
          const editing = renaming?.key === r.key;
          const title = titleOf(r);
          const label = r.engineeringSessionId
            ? `${title} · Code · ${r.engineeringRepo ?? 'repository'}${r.engineeringState ? ` · ${ENG_LABEL[r.engineeringState] ?? r.engineeringState}` : ''}`
            : `${r.task ? `#${r.task.number} · ` : ''}${title}${state ? ` · ${STATE_LABEL[state] ?? state}` : ''}${status ? ` · ${THREAD_STATUS_LABEL[status]}` : ''}${r.channelSlug ? ` · #${r.channelSlug}` : ''}`;
          const glyphEl = (
            /* THE GLYPH GUTTER: the kind of thing this row is (lib/rowglyph.ts). The orb takes the
               gutter while an agent works in there — a SWAP, not an addition (orb round,
               2026-08-17), and it stands bare (2026-08-19). Colour survives only for an active
               task's state; a settled task is a check, a waiting one a hollow circle. */
            <span className={`navhistglyph g-${glyph}`} aria-hidden>
              {glyph === 'orb' ? <Orb state={run ? orbStateFor(run.step ?? '', null, run.role) : 'working'} label={run?.step ?? (kind === 'code' ? 'Code is working' : 'working')} />
                : glyph === 'clock' ? <IconRoutineClock s={12} />
                : glyph === 'code' ? <IconCode s={13} />
                : glyph === 'chat' ? <IconThreads s={13} />
                : glyph === 'circle' ? <IconCircleGlyph s={13} />
                : glyph === 'check' ? <IconCheckCircle s={13} />
                : <span className={`navhistdot${state ? ` c-${state}` : ''}`} />}
            </span>
          );
          return (
          <div key={r.key} className={`navhistwrap${canRename || canArchive || canSettle ? ' acts' : ''}${editing ? ' editing' : ''}`}
            onMouseEnter={(e) => {
              // THE MARQUEE (George, 2026-09-04 — Codex's hover): measure how far the title
              // overflows and let the CSS scroll it exactly that far, then hold; 0 means no motion
              const t = e.currentTarget.querySelector<HTMLElement>('.navhisttitle');
              const ov = t ? Math.max(0, t.scrollWidth - t.clientWidth) : 0;
              e.currentTarget.style.setProperty('--nh-ov', `${ov}px`);
              e.currentTarget.style.setProperty('--nh-dur', `${Math.max(1.2, ov / 40).toFixed(2)}s`);
              if (!editing && !rowMenu) armHover(r, e.currentTarget);
            }}
            onMouseLeave={disarmHover}>
          {editing ? (
            <div className="navhistrow on">
              {glyphEl}
              <input className="navhistedit" value={renaming!.value} autoFocus aria-label="New title" maxLength={120}
                onChange={(e) => setRenaming({ key: r.key, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(r); } }}
                onBlur={() => setRenaming(null)} />
            </div>
          ) : (
            <button
              className={`navhistrow${selected ? ' on' : ''}`}
              aria-current={selected ? 'true' : undefined}
              aria-label={label}
              // the row carries its OWN room to the shell — see onOpenThread in HistoryRail's props
              onClick={() => foreign && onOpenOn ? onOpenOn(r) : r.engineeringSessionId ? onOpenEngineering(r.engineeringSessionId) : (r.task ? onOpenTask(r.task.id) : onOpenThread(r.threadId!, r.channelId))}
              onFocus={(e) => armHover(r, e.currentTarget)}
              onBlur={disarmHover}
            >
              {glyphEl}
              {r.task && <span className="navhistnum">{r.task.number}</span>}
              <span className="navhisttitle"><span className="nhscroll">{title}</span></span>
              <span className="navhisttrail">
                {/* THE STATUS WORD (settle round, mark M4): the row says which of the three it is,
                    so the control beside it never names a state the row hid. */}
                {trail.kind === 'status' ? <span className={`navhiststat st-${trail.status}`}>{THREAD_STATUS_LABEL[trail.status]}</span>
                  : trail.kind === 'ask' ? <span className="navhistask" aria-label="Needs you" />
                  : trail.kind === 'frac' ? <span className="nhlfrac">{trail.text}</span>
                  : <span className="navhistfact">{trail.text}</span>}
              </span>
            </button>
          )}
          {(canRename || canArchive || canSettle) && !editing && (
            <RowActs title={title} settle={canSettle} menuOpen={rowMenu?.key === r.key}
              onRename={canRename ? () => startRename(r) : undefined}
              onSettle={() => { disarmHover(); onSettle!(r.threadId!); }}
              onMenu={(b) => { disarmHover(); setRowMenu(rowMenu?.key === r.key ? null : { key: r.key, row: r, left: Math.round(b.right + 8), top: Math.round(Math.min(b.top, window.innerHeight - 110)) }); }} />
          )}
          </div>
          );
  };

  return (
    <div className="navhist">
      {grouped || (recents && groups) ? (
        <NavGroupsHead view={recents ? 'recents' : 'projects'} onView={(v) => onView?.(v)} count={banded ? bandsHead(bands!, recents).count : recents ? rows.length : groups!.groups.length} askFolded={banded ? bandsHead(bands!, recents).askFolded : !recents && groups!.askFolded} collapsed={collapsed} onToggle={onToggle} onExpand={onExpand} />
      ) : (
        <NavScopeRow {...{ askOutside, channels, collapsed, menu, onAllProjects, onExpand, onNewChannelIn, onNewProject, onPickChannel, onPickProject, onToggle, projects, scopeChannel, scopeProject, setMenu }} />
      )}
      {collapsed ? null : (<>
      {/* THE ROOM STRIP (2026-08-09), now the inside of a project. It replaced a hover-only `#`
          popover because an empty room you cannot see is a room you will never post in — which is
          how three of four default rooms stayed unused. That reason is unchanged; only its count
          is: ONE strip, for the project you picked, instead of one per project whether you were
          looking at it or not. The `+N` opens the room chip's own menu rather than minting a
          second popover for the same list. */}
      {!grouped && !recents && channels.length > 0 && (() => {
        const { visible, more } = stripChannels(channels);
        const filtered = !!scopeChannel;
        const chip = (c: NavTreeChannel) => (
          <button
            key={c.id}
            type="button"
            className={`navchanchip${filtered && c.on ? ' on' : ''}`}
            title={filtered && c.on ? `Showing #${c.slug} — click to show every room` : `Show only #${c.slug}`}
            aria-pressed={filtered && c.on}
            onClick={() => onPickChannel(filtered && c.on ? null : c.id)}
          >
            <span className="h" aria-hidden>#</span>{c.slug}
            {c.hasAsk && <span className="navchanask" title="Something in here needs you" aria-label="Needs you" />}
          </button>
        );
        return (
          <div className="navchanstrip">
            {visible.map(chip)}
            {more > 0 && (
              <button type="button" className="navchanchip morechip" aria-haspopup="menu"
                title={`All ${channels.length} rooms in ${scopeProject?.name ?? 'this project'}`}
                onClick={() => setMenu('room')}>+{more} more</button>
            )}
            <button type="button" className="navchanchip add" data-tip={`New channel in ${scopeProject?.name ?? 'this project'}`}
              aria-label="New channel" onClick={() => scopeProject && onNewChannelIn(scopeProject.id)}>＋</button>
          </div>
        );
      })()}
      <div className="navhistlist" onScroll={disarmHover}>
        {banded && <NavBands bands={bands!} recents={recents} codeMode={codeMode} rowEl={rowEl} onToggleBand={onToggleBand} projectRooms={projectRooms} onToggleFold={onToggleFold} onShowMore={onShowMore} onNewChatIn={onNewChatIn} onAllProjects={onAllProjects} />}
        {!banded && rows.length === 0 && !filteredOut && (
          <div className="navhistempty">{codeMode ? 'No code work yet — a task with a repo lands here' : scopeProject ? 'No conversations here yet' : 'No threads yet'}</div>
        )}
        {filteredOut && <div className="navhistempty">No threads in the room you picked</div>}
        {!banded && !grouped && (recents ? rows.slice(0, NAV_RECENTS_CAP * recentPages) : rows).map((r) => rowEl(r))}
        {!banded && recents && rows.length > NAV_RECENTS_CAP * recentPages && (
          <button type="button" className="navgrpmore flat" onClick={() => setRecentPages((n) => n + 1)}>Show {Math.min(NAV_RECENTS_CAP, rows.length - NAV_RECENTS_CAP * recentPages)} more</button>
        )}
        {!banded && grouped && !groups!.groups.length && !groups!.orphans.length && (
          <div className="navhistempty">{codeMode ? 'No code work yet — a task with a repo lands here' : 'No threads yet'}</div>
        )}
        {!banded && grouped && <NavGroups groups={groups!} rowEl={rowEl} projectRooms={projectRooms} onToggleFold={onToggleFold} onShowMore={onShowMore} onNewChatIn={onNewChatIn} onAllProjects={onAllProjects} />}
        {moreCount > 0 && !grouped && !recents && (
          // one cap, one door. The tree's two-stage `n more ›` → `n more in history` existed to
          // stop one expanded project burying its neighbours; with no groups left there are no
          // neighbours to bury, and the rest is history's job.
          <button className="navprojmore" onClick={onExpand}>Everything else <span className="k">⌘Y</span></button>
        )}
      </div>
      <RowCard hover={hover && !rowMenu && !renaming ? hover : null} liveRuns={liveRuns} />
      <RowMenu menu={rowMenu} onClose={() => setRowMenu(null)} onRename={onRename ? startRename : undefined} onArchive={onArchive} settleOf={settleOf} onSettle={onSettle} />
      </>)}
    </div>
  );
}

/**
 * Can this row be archived (0108)?
 *
 * CHAT THREADS ONLY, decided in the design round: a task thread is the board's record of a work
 * attempt, so hiding it would leave a task that still counts as open with nowhere to read it. A
 * legacy loose room message (`rootMessageId`, no thread of its own) has nothing to archive either.
 */
export function archivableThreadId(row: HistoryRow<TaskAllRow>): string | null {
  if (row.state || row.task || row.rootMessageId) return null;
  return row.threadId;
}
